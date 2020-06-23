window.id = null;
window.socket = null;
window.tunnel = null;
window.tunnel_after_connect = null;

const $ = document.querySelector.bind(document);

function onLoad() {
    refreshFiles();
    // connect();
    let host = $("#hostname");
    if (!host.value) {
        host.value = getHostname();
    }
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
        let bytes = (content.replace("=", "").length * 6) / 8;
        if (bytes > 1.44 * 1000 * 1000) {
            alert("files over 1.44mb are prohibited");
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
        window.socket = null;
    }
    window.socket = new WebSocket("wss://lab.spaghetti.rocks:8088");
    window.socket.onmessage = onMessage;
    window.socket.onopen = onOpen;
    window.socket.onclose = onClose;
    window.socket.onerror = onClose;
}

function onStateChange(event) {
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
    onStateChange(event);
    console.log(event);
    let message = event.reason ? event.reason : "No Reason";
    $("#error").innerHTML = `${event.code} (${message})`;
    $("#peer-list").innerHTML = "";
}

function onOpen(event) {
    onStateChange(event);
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
            setFrame(`<!DOCTYPE html><html><body bgcolor="white">
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
            setFrame(`<!DOCTYPE html><html><body bgcolor="white">
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
                            "content": makeFileList()
                        }));
                    } else if (isFile(message.path)) {
                        window.socket.send(JSON.stringify({
                            "action": "tunnel_data",
                            "tunnel_action": "response",
                            "id": window.tunnel,
                            "content_type": "application/octet-stream",
                            "content": getFile(message.path)
                        }));
                    }
                } break;

                case "response": {
                    if (message.content_type === "text/html") {
                        setFrame(message.content);
                    } else {
                        setFrame(`<object data="${message.content}"></object>`);
                    }
                    window.socket.send(JSON.stringify({
                        "action": "close_tunnel",
                        "id": message.id
                    }));
                } break;
            }
        } break;

        default: break;
    }
}

function setFiles(files) {
    window.sessionStorage.setItem("files", JSON.stringify(files));
}

function isFile(path) {
    return !!getFile(path);
}

function getFile(path) {
    return getFiles()[path];
}

function getFiles() {
    let files = window.sessionStorage.getItem("files");
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
        fileList += `<tr><td><a href="/${file}">/${file}</a></td></tr>`;
    }

    return `<!DOCTYPE html>
<html>
<body bgcolor="white">
<h1>Index of /</h1><br>
<table>
<tbody>
<tr><th>Name</th></tr>
<tr><th colspan="1"><hr></th></tr>
${fileList}
<tr><th colspan="1"><hr></th></tr>
</tbody>
</table>
<address>
todo: server address
</address>
</body>
</html>`;
}

function test() {
    setFrame(`
<!DOCTYPE html>
<html>
<body bgcolor="white">
<a href="/niko_roomba.png">abspath</a>
<a href="vgwp://${window.id}/niko_roomba.png">withdomain</a>
</body>
</html>
`);
}

function setFrame(content) {
    let blob = new Blob([content], {type: "text/html"});
    let frame = $("#browser-frame");
    frame.src = URL.createObjectURL(blob);
    frame.onload = function() {
        let urlRegex = /(^vgwp:\/\/.+$)|(^[^:]+$)/;

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
    }
}

function requestPage(url) {
    let parts = /vgwp:\/\/([^\/]+)(\/(.*))?/.exec(url);
    if (!parts || !parts[1]) {
        setFrame(`<!DOCTYPE html><html><body bgcolor="white">
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
            "path": parts[2] ? parts[2] : "/index"
        }));
    }

    if (!window.tunnel) {
        window.tunnel_after_connect = after_connect;
    } else {
        after_connect();
    }
}

function activatePeer(peerName) {
    let urlBar = $("#url").value = `vgwp://${peerName}/`;
    goUrl();
}

function resolveUrl(relUrl) {
    let original = $("#url").value;
    let urlRegex = /(^vgwp:\/\/.+$)|(^[^:]+$)/;

    if (relUrl[0] === "/") {
        let parts = /vgwp:\/\/([^\/]+)(\/(.*))?/.exec(original);
        console.log(parts);
        return `vgwp://${parts[1]}${relUrl}`;
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
