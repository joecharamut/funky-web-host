window.id = null;
window.socket = null;
window.tunnel = null;
window.tunnel_after_connect = null;

const $ = document.querySelector.bind(document);
let fileStore = "";
let requestCallbacks = {};
let closeTimeout = null;

function onLoad() {
    refreshFiles();
    // connect();
    let host = $("#hostname");
    if (!host.value) {
        host.value = getHostname();
    }
    goUrl();
}

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function getBase64(file, callback) {
    let reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function() {
        callback(reader.result)
    };
    reader.onerror = function(error) {
        console.log('Error: ', error);
    };
}

function getHostname() {
    let host = $("#hostname");
    if (!host.value) {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    return host.value;
}

function storeFile() {
    let f = $("#file").files[0];
    getBase64(f, function(content) {
        let bytes = (content.length * 6) / 8;
        if (getFileSize() + bytes > 10 * 1000 * 1000) {
            alert("storage limit is 10mb");
            return;
        }

        let files = getFiles();
        files[f.name] = content;

        setFiles(files);
        console.log("stored file " + f.name);
        refreshFiles();
    });
}

function deleteFile() {
    let list = $("#file-list");
    let items = list.childNodes;
    for (let i = 0; i < items.length; i++) {
        let item = items[i];
        if (item.style.color === "white") {
            let name = item.innerHTML;
            let files = getFiles();
            delete files[name];
            setFiles(files);
            refreshFiles();
            return;
        }
    }
}

function refreshFiles() {
    let list = $("#file-list");
    list.innerHTML = "";

    let files = Object.keys(getFiles());
    for (let i = 0; i < files.length; i++) {
        list.innerHTML += `<li style="cursor: pointer" onclick="setSelectedFile(${i})">${files[i]}</li>`;
    }

    let storage = $("#storage");
    let storageText = $("#storage-text");
    let fileSize = getFileSize();
    let megabytes = (fileSize / (1000 * 1000));
    storageText.innerHTML = Math.round(megabytes * 100) / 100 + "MB";
    storage.value = (megabytes / 10) * 100;
}

function getFileSize(file = "") {
    if (!file) {
        let fileSize = 0;
        let fileStrings = Object.values(getFiles());
        for (let i = 0; i < fileStrings.length; i++) {
            let str = fileStrings[i];
            let bytes = str.split(",")[1].length * 6 / 8;
            fileSize += bytes;
        }
        return fileSize;
    } else {
        let fileString = getFile(file);
        let bytes = fileString.split(",")[1].length * 6 / 8;
        return bytes;
    }
}

function highlightTreeItem(list, index) {
    let items = list.childNodes;
    for (let i = 0; i < items.length; i++) {
        items[i].style.backgroundColor = "inherit";
        items[i].style.outline = "inherit";
        items[i].style.color = "inherit";
    }
    items[index].style.backgroundColor = "navy";
    items[index].style.outline = "1px dotted #00f";
    items[index].style.color = "white";
}

function setSelectedFile(index) {
    highlightTreeItem($("#file-list"), index);
}

function setSelectedPeer(index) {
    highlightTreeItem($("#peer-list"), index);
}

function connect() {
    if (window.socket) {
        window.socket.close(1000);
    }
    window.socket = new WebSocket("wss://lab.spaghetti.rocks:8088");
    onStateChange();
    window.socket.onmessage = onMessage;
    window.socket.onopen = onOpen;
    window.socket.onclose = onClose;
    window.socket.onerror = onClose;
}

function disconnect() {
    if (window.socket) {
        window.socket.close(1000);
    }
}

function onStateChange() {
    $("#status").innerHTML = ((state) => {
        switch (state) {
            case WebSocket.CLOSED:
                return "Closed";
            case WebSocket.CLOSING:
                return "Closing";
            case WebSocket.OPEN:
                return "Open";
            case WebSocket.CONNECTING:
                return "Connecting";
        }
    })(window.socket.readyState);
}

function onClose(event) {
    onStateChange();
    console.log(event);
    let message = event.reason ? event.reason : "No Reason";
    $("#error").innerHTML = `${event.code} (${message})`;
    $("#peer-list").innerHTML = "";
}

function onOpen(event) {
    onStateChange();
    $("#error").innerHTML = "";
    window.id = getHostname();
    window.socket.send(JSON.stringify({"action":"connect", "name":window.id}));
}

function onMessage(event) {
    console.log(event);
    let message = JSON.parse(event.data);
    console.log(message);
    switch (message.action) {
        case "sync": {
            let list = $("#peer-list");
            list.innerHTML = "";
            for (let i = 0; i < message.peers.length; i++) {
                let peerName = message.peers[i];
                list.innerHTML += `<li style="cursor: pointer" onclick="setSelectedPeer(${i}); activatePeer('${peerName}')">${peerName}</li>`;
            }
        } break;

        case "tunnel_request": {
            if (!window.tunnel) {
                window.tunnel = message.id;
                window.socket.send(JSON.stringify({
                    "action": "accept_tunnel",
                    "id": message.id
                }));
            } else {
                window.socket.send(JSON.stringify({
                    "action": "reject_tunnel",
                    "id": message.id,
                    "message": "Host is Busy"
                }));
            }
        } break;

        case "tunnel_success": {
            window.tunnel = message.id;
            if (window.tunnel_after_connect) {
                window.tunnel_after_connect();
                window.tunnel_after_connect = null;
            }
        } break;

        case "tunnel_reject": {
            window.tunnel = null;
            window.tunnel_after_connect = null;
            setFrame(`<!DOCTYPE html><html><body>
                      <h1>503 Service Unavailable</h1>
                      <p>Peer refused connection: ${message.message}</p>
                      </body></html>`);
        } break;

        case "tunnel_close": {
            window.tunnel = null;
            window.tunnel_after_connect = null;
        } break;

        case "tunnel_not_found": {
            window.tunnel = null;
            window.tunnel_after_connect = null;
            setFrame(`<!DOCTYPE html><html><body>
                      <h1>404 Not Found</h1>
                      <p></p>
                      </body></html>`);
        } break;

        case "tunnel_data": {
            switch (message.tunnel_action) {
                case "request": {
                    message.path = message.path.substr(1);
                    if (message.path === "index" || !message.path) {
                        window.socket.send(JSON.stringify({
                            "action": "tunnel_data",
                            "tunnel_action": "response",
                            "id": window.tunnel,
                            "content_type": "text/html",
                            "content": makeFileList(),
                            "requestFor": message.requestFor
                        }));
                    } else if (isFile(message.path)) {
                        let content = getFile(message.path);
                        let header = content.split(",")[0];
                        let contentType = header.substr(5).split(";")[0];
                        if (contentType === "text/html") {
                            console.log();
                            window.socket.send(JSON.stringify({
                                "action": "tunnel_data",
                                "tunnel_action": "response",
                                "id": window.tunnel,
                                "content_type": "text/html",
                                "content": atob(content.split(",")[1]),
                                "requestFor": message.requestFor,
                                "statusCode": 200
                            }));
                        } else {
                            window.socket.send(JSON.stringify({
                                "action": "tunnel_data",
                                "tunnel_action": "response",
                                "id": window.tunnel,
                                "content_type": "application/octet-stream",
                                "content": getFile(message.path),
                                "requestFor": message.requestFor,
                                "statusCode": 200
                            }));
                        }
                    } else {
                        window.socket.send(JSON.stringify({
                            "action": "tunnel_data",
                            "tunnel_action": "response",
                            "id": window.tunnel,
                            "content_type": "text/html",
                            "content": `<!DOCTYPE html><html><body>
                                        <h1>404 Not Found</h1>
                                        <p></p>
                                        </body></html>`,
                            "requestFor": message.requestFor,
                            "statusCode": 404
                        }));
                    }
                } break;

                case "response": {
                    if (!message.requestFor) {
                        if (message.content_type === "text/html") {
                            setFrame(message.content);
                        } else {
                            setFrame(`<object data="${message.content}"></object>`);
                        }
                    } else {
                        if (requestCallbacks[message.requestFor]) {
                            requestCallbacks[message.requestFor](message.content, message.statusCode);
                            delete requestCallbacks[message.requestFor];
                        }
                    }

                    clearTimeout(closeTimeout);
                    closeTimeout = setTimeout((function(tunnelId) {
                        return function () {
                            window.socket.send(JSON.stringify({
                                "action": "close_tunnel",
                                "id": tunnelId
                            }));
                        }
                    })(message.id), 1000);
                } break;
            }
        } break;

        default: break;
    }
}

function setFiles(files) {
    // window.sessionStorage.setItem("files", JSON.stringify(files)); // RIP (5M char limit)
    fileStore = JSON.stringify(files);
}

function isFile(path) {
    return !!getFile(path);
}

function getFile(path) {
    return getFiles()[path];
}

function getFiles() {
    // let files = window.sessionStorage.getItem("files"); // RIP (5M char limit)
    let files = fileStore;
    if (files) {
        files = JSON.parse(files);
    } else {
        files = {};
    }
    return files;
}

function makeFileList() {
    let files = Object.keys(getFiles());
    let fileList = "";
    for (var i = 0; i < files.length; i++) {
        let file = files[i];
        fileList += `<tr>
                     <td><a href="/${file}">${file}</a></td>
                     <td style="text-align: right">${Math.round(getFileSize(file) / 1000 * 10) / 10}K</td>
                     </tr>`;
    }

    return `<!DOCTYPE html>
<html>
<body>
<h1>Index of /</h1><br>
<table style="font-family: monospace">
<tbody>
<tr><th>Name</th><th>Size</th></tr>
<tr><th colspan="2"><hr></th></tr>
${fileList}
<tr><th colspan="2"><hr></th></tr>
</tbody>
</table>
<address>
Someone's Browser at cool://${window.id}
</address>
</body>
</html>`;
}

function setFrame(content) {
    let blob = new Blob([content], {type: "text/html"});
    let frame = $("#browser-frame");
    frame.src = URL.createObjectURL(blob);
    frame.onload = function() {
        let urlRegex = /(^cool:\/\/.+$)|(^[^:]+$)/;

        // fix <a> tags
        let links = frame.contentDocument.getElementsByTagName("a");
        for (let i = 0; i < links.length; i++) {
            let a = links[i];
            let href = a.href;
            let matches = urlRegex.exec(href);
            if (matches) {
                if (matches[2]) {
                    a.href = resolveUrl(matches[2]);
                }
                a.onclick = (function (myHref) {
                    return function(event) {
                        event.preventDefault();
                        console.log(myHref);
                        goRelativeUrl(myHref);
                    }
                })(href);
            }
        }

        // fix <img> tags
        let imgs = frame.contentDocument.getElementsByTagName("img");
        for (let i = 0; i < imgs.length; i++) {
            let img = imgs[i];
            let src = img.src;
            let matches = urlRegex.exec(src);
            if (matches) {
                if (matches[2]) {
                    src = resolveUrl(matches[2]);
                }
                img.src = "";
                let requestId = uuidv4();
                requestCallbacks[requestId] = (function(element) {
                    return function(content, statusCode) {
                        if (statusCode === 200) {
                            element.src = content;
                        } else {
                            element.src = "";
                        }
                    }
                })(img);
                requestPage(src, requestId);
            }
        }
    }
}

function handleAboutPage(pageId) {
    setFrame((function() {
        switch (pageId) {
            case "blank": {
                return `<!DOCTYPE html><html><body>
                        <h1>Web Host Experiment Thing</h1>
                        <h3>Requirements:</h3>
                        <p>
                        <ul>
                            <li>Minimum screen resolution of 800x600</li>
                            <li><a href="https://caniuse.com/#feat=websockets">Browser that supports websockets</a></li>
                            <li>Preferably not a mobile device</li>
                        </ul>
                        </p>
                        <h3>How to use:</h3>
                        <p>
                        (very experimental so far)<br>
                        Set a hostname on the sidebar<br>
                        Select some files if you want (you can do this later)<br>
                        Click connect to connect to the network and share your files<br>
                        </p>
                        <h3>General Info:</h3>
                        <p>
                        So basically you can host files from your browser as sort of a server<br>
                        but it connects to a central server to pass the stuff from browser to browser<br>
                        I mean its pretty much p2p web hosting<br><br>
                        kind of<br><br>
                        All your files are stored in javascript so if you refresh or close the tab its all gone<br>
                        Also for uploaded html pages only &lt;a&gt; tags and &lt;img&gt; tags work with cool:// urls<br>
                        Oh and the back and forward buttons dont work for the url bar yet<br>
                        </p>
                        <h3>Technical Info:</h3>
                        <p>
                        It's almost all in the browser with normal javascript<br>
                        Other than the server, which is written in python<br>
                        The 10MB limit is just for fun<br>
                        Although if you do go over it the server kills your connection<br><br>
                        <a href="https://github.com/joecharamut/funky-web-host">sauce code</a>
                        </p>
                        </body></html>`;
            } break;

            default: {
                return `<!DOCTYPE html><html><body>
                        <h1>404 Not Found</h1>
                        <p></p>
                        </body></html>`
            } break;
        }
    })());
}

function requestPage(url, requestFor = "") {
    if (url.startsWith("about:")) {
        handleAboutPage(url.split(":")[1]);
        return;
    }

    let parts = /cool:\/\/([^\/]+)(\/(.*))?/.exec(url);
    if (!parts || !parts[1]) {
        setFrame(`<!DOCTYPE html><html><body>
                  <h1>400 Bad Request</h1>
                  <p>The request URI is invalid</p>
                  </body></html>`);
        return;
    }
    if (!window.tunnel) {
        window.socket.send(JSON.stringify({
            "action": "request_tunnel",
            "peer": parts[1]
        }));
    }

    let after_connect = function() {
        window.socket.send(JSON.stringify({
            "action": "tunnel_data",
            "tunnel_action": "request",
            "id": window.tunnel,
            "path": parts[2] ? parts[2] : "/index",
            "requestFor": requestFor
        }));
    }

    if (!window.tunnel) {
        window.tunnel_after_connect = after_connect;
    } else {
        after_connect();
    }
}

function activatePeer(peerName) {
    let urlBar = $("#url").value = `cool://${peerName}/`;
    goUrl();
}

function resolveUrl(relUrl) {
    let original = $("#url").value;
    let urlRegex = /(^cool:\/\/.+$)|(^[^:]+$)/;

    if (relUrl[0] === "/") {
        let parts = /cool:\/\/([^\/]+)(\/(.*))?/.exec(original);
        console.log(parts);
        return `cool://${parts[1]}${relUrl}`;
    }

    let parts = urlRegex.exec(relUrl);
    if (parts[1]) {
        return relUrl;
    }
}

function goRelativeUrl(relUrl) {
    $("#url").value = resolveUrl(relUrl);
    goUrl();
}

function goUrl() {
    requestPage($("#url").value);
}
