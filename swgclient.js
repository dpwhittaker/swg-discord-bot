const SOEProtocol = require("./SOEProtocol");
const dgram = require('dgram');

var server = {};
module.exports.login = function(cfg) {
    server = cfg;
    Login();
}
module.exports.isConnected = false;
module.exports.paused = false;
module.exports.sendChat = function(message, user) {
    if (!module.exports.isConnected) return;
    console.log("sending chat to game: " + user + ": " + message);
    send("ChatSendToRoom", {Message: ' \\#ff3333' + user + ': \\#ff66ff' + message, RoomID: server.ChatRoomID});
}
module.exports.recvChat = function(message, player) {}
module.exports.serverDown = function() {}
module.exports.serverUp = function() {}
module.exports.reconnected = function() {}
module.exports.sendTell = function(player, message) {
    if (!module.exports.isConnected) return;
    console.log("sending tell to: " + player + ": " + message);
    send("ChatInstantMessageToCharacter", {ServerName: server.ServerName, PlayerName: player, Message: message});
}
module.exports.recvTell = function(from, message) {}

var lastMessageTime = new Date();
function handleMessage(msg, info) {
    lastMessageTime = new Date();
    if (info.port == server.PingPort) return;
    var packets;
    try {
        packets = SOEProtocol.Decode(msg);
    } catch (ex) {
        console.log(ex.toString());
        Login();
        return;
    }
    if (!packets) return;
    for (var packet of packets) {
        //if (!packet.type.startsWith("1b24f808"))
            console.log("recv: " + packet.type);
        if (handlePacket[packet.type])
            handlePacket[packet.type](packet);
        //else console.log("No handler for " + packet.type);
    }
}

var socket;
var loggedIn;

var handlePacket = {};
handlePacket["Ack"] = function(packet) {}
handlePacket["SessionResponse"] = function(packet) {
    if (!loggedIn) {
        send("LoginClientID", {Username: server.Username, Password:server.Password});
    } else {
        send("ClientIdMsg");
    }
}
handlePacket["LoginClientToken"] = function(packet) {
    loggedIn = true;
}
handlePacket["LoginEnumCluster"] = function(packet) {
    server.ServerNames = packet.Servers;
}
handlePacket["LoginClusterStatus"] = function(packet) {
    console.log(packet);
    server.Servers = packet.Servers;
}
handlePacket["EnumerateCharacterId"] = function(packet) {
    var character = packet.Characters[server.Character];
    if (!character)
        for (var c in packet.Characters)
            if (packet.Characters[c].Name.startsWith(server.Character))
                character = packet.Characters[c];
    var serverData = server.Servers[character.ServerID];
    server.Address = serverData.IPAddress;
    server.Port = serverData.Port;
    server.PingPort = serverData.PingPort;
    server.CharacterID = character.CharacterID;
    server.ServerName = server.ServerNames[character.ServerID].Name;
    send("SessionRequest");
}
handlePacket["ClientPermissions"] = function(packet) {
    send("SelectCharacter", {CharacterID: server.CharacterID});
    setTimeout(() => {
        send("ChatCreateRoom", {RoomPath: `SWG.${server.ServerName}.${server.ChatRoom}`})
        setTimeout(() => send("CmdSceneReady"), 1000);
    }, 1000);
}
handlePacket["ChatRoomList"] = function(packet) {
    console.log(JSON.stringify(packet, null, 2));
    for (var roomID in packet.Rooms) {
        var room = packet.Rooms[roomID];
        if (room.RoomPath.endsWith(server.ChatRoom)) {
            server.ChatRoomID = room.RoomID;
            send("ChatEnterRoomById", {RoomID: room.RoomID});
        }
    }
}
handlePacket["ChatOnEnteredRoom"] = function(packet) {
    console.log(JSON.stringify(packet, null, 2));
    if (packet.RoomID == server.ChatRoomID && packet.PlayerName == server.Character) {
        if (!module.exports.isConnected) {
            module.exports.isConnected = true;
            console.log("connected");
            module.exports.reconnected();
        }
        if (fails >= 3) module.exports.serverUp();
        fails = 0;
    }
}
handlePacket["ChatRoomMessage"] = function(packet) {
    console.log(JSON.stringify(packet, null, 2));
    if (packet.RoomID == server.ChatRoomID && packet.CharacterName != server.Character.toLowerCase())
        module.exports.recvChat(packet.Message, packet.CharacterName);
}
handlePacket["ChatInstantMessageToClient"] = function(packet) {
    module.exports.recvTell(packet.PlayerName, packet.Message);
}

function Login() {
    loggedIn = false;
    module.exports.isConnected = false;

    server.Address = server.LoginAddress;
    server.Port = server.LoginPort;
    server.PingPort = undefined;

    socket = dgram.createSocket('udp4');
    socket.on('message', handleMessage);

    send("SessionRequest");
}

function send(type, data) {
    var buf = SOEProtocol.Encode(type, data);
    if (buf) {
        console.log("send: " + type);
        if (Array.isArray(buf)) {
            for (var b of buf) {
                socket.send(b, server.Port, server.Address);
            }
        }
        else
            socket.send(buf, server.Port, server.Address);
    }
}

var fails = 0;
setInterval(() => {
    if (module.exports.paused) return;
    send("Ack");
    if (new Date() - lastMessageTime > 10000) {
        fails++;
        module.exports.isConnected = false;
        if (fails == 3) module.exports.serverDown();
        lastMessageTime = new Date();
        Login();
    }
}, 100);

setInterval(() => {
    if (!server.PingPort || !module.exports.isConnected) return;
    var buf = new Buffer(4);
    buf.writeUInt32LE((new Date().getTime() & 0xFFFFFFFF) >>> 0);
    socket.send(buf, server.PingPort, server.Address);
}, 1000);

setInterval(() => {
    if (!module.exports.isConnected) return;
	send("NetStatusRequest");
}, 40000);
