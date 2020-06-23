from typing import Optional, List, Set, Dict

import websockets
import asyncio
import json
import uuid
import ssl


class Client:
    id: Optional[str]
    socket: websockets.WebSocketServerProtocol

    def __init__(self, websocket: websockets.WebSocketServerProtocol) -> None:
        self.socket = websocket
        self.id = None

    async def send(self, data: dict) -> None:
        await self.socket.send(json.dumps(data))


class Tunnel:
    a: Optional[Client]
    b: Optional[Client]

    def __init__(self) -> None:
        self.a = None
        self.b = None

    async def send(self, sender: Client, data: dict):
        if sender.id == self.a.id:
            await self.b.send(data)
        elif sender.id == self.b.id:
            await self.a.send(data)


clients: Set[Client] = set()
tunnels: Dict[str, Tunnel] = dict()


async def register(websocket: websockets.WebSocketServerProtocol) -> Client:
    client = Client(websocket)
    clients.add(client)
    return client


async def unregister(websocket: websockets.WebSocketServerProtocol) -> None:
    client = None
    for client in clients:
        if client.socket.remote_address == websocket.remote_address:
            clients.remove(client)
            break
    for id, tun in tunnels.items():
        if tun.a == client:
            await tun.b.send({"action": "tunnel_close"})
        if tun.b == client:
            await tun.a.send({"action": "tunnel_close"})
        del tunnels[id]
    for c in clients:
        await do_sync_client(c)


async def do_sync_client(client: Client, name: Optional[str] = None) -> None:
    if name:
        client.id = name
    await client.send({
        "action": "sync",
        "peers": [tup.id for tup in clients]
    })


async def app(websocket: websockets.WebSocketServerProtocol, path: str) -> None:
    addr = websocket.remote_address
    try:
        print(f"connect {addr}")
        client = await register(websocket)

        async for message in websocket:
            data: dict
            data = json.loads(message)

            if "action" not in data:
                continue

            print(data)

            action = data["action"]
            if action == "connect":
                if not client.id:
                    if "name" in data.keys():
                        await do_sync_client(client, data["name"])
                    for c in clients:
                        await do_sync_client(c)
            elif action == "request_tunnel":
                if "peer" in data.keys():
                    peer = data["peer"]
                    for c in clients:
                        if c.id == peer:
                            tun_id = str(uuid.uuid4())
                            await c.send({
                                "action": "tunnel_request",
                                "id": tun_id,
                                "from": client.id
                            })
                            tun = tunnels[tun_id] = Tunnel()
                            tun.a = client
                            break
                    else:
                        await client.send({
                            "action": "tunnel_not_found"
                        })
            elif action == "accept_tunnel":
                if "id" in data.keys():
                    id = data["id"]
                    if id in tunnels:
                        tun = tunnels[id]
                        tun.b = client
                        await tun.a.send({"action": "tunnel_success", "id": id})
                        await tun.b.send({"action": "tunnel_success", "id": id})
            elif action == "reject_tunnel":
                if "id" in data.keys():
                    id = data["id"]
                    if id in tunnels:
                        await tunnels[id].a.send({"action": "tunnel_reject"})
                        del tunnels[id]
            elif action == "close_tunnel":
                if "id" in data.keys():
                    id = data["id"]
                    if id in tunnels:
                        tun = tunnels[id]
                        if tun.a:
                            await tun.a.send({"action": "tunnel_close"})
                        if tun.b:
                            await tun.b.send({"action": "tunnel_close"})
                        del tunnels[id]
            elif action == "tunnel_data":
                if "id" in data.keys():
                    id = data["id"]
                    if id in tunnels:
                        await tunnels[id].send(client, data)
    finally:
        await unregister(websocket)
        print(f"disconnect {addr}")


address = ("0.0.0.0", 8088)
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_context.load_cert_chain("fullchain.pem", "privkey.pem")
start_server = websockets.serve(app, address[0], address[1], ssl=ssl_context)


if __name__ == "__main__":
    print(f"running server on {address}")
    loop = asyncio.get_event_loop()
    loop.run_until_complete(start_server)
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        raise
