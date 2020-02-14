const zlib = require('zlib');
const crypto = require('crypto');

const session = {lastAck: -1, lastSequence: -1};

var fragments = null, fragmentLength;
var DecodeSOEPacket = module.exports.Decode = function (buf, decrypted) {
    if (!Buffer.isBuffer(buf)) buf = new Buffer(buf, "hex");
    var SOEHeader = buf.readUInt16BE(0);
    if (SOEHeader > 0x2 && !decrypted) buf = Decrypt(buf);
    var len, opcode;
    console.log(buf.toString('hex'));
    console.log(buf.toString('ascii').replace(/[^A-Za-z0-9!"#$%&'()*+,.\/:;<=>?@\[\] ^_`{|}~-]/g, ' ').split('').join(' '));
    if (SOEHeader == 0x1) {
        return [{type: "SessionRequest",
            CRCLength: buf.readUInt32BE(2),
            ConnectionID: buf.readUInt32BE(6).toString(16),
            ClientUDPSize: buf.readUInt32BE(10)
        }];
    }
    else if (SOEHeader == 0x2) {
        session.type = "SessionResponse";
        session.connectionID = buf.readUInt32BE(2);
        session.CRCSeed = buf.readUInt32BE(6);
        session.CRCLength = buf.readUInt8(10);
        session.UseCompression = buf.readUInt8(11);
        session.SeedSize = buf.readUInt8(12);
        session.ServerUDPSize = buf.readUInt32BE(13);
        session.sequence = 0;
        session.lastAck = -1;
        session.lastSequence = -1;
        session.RequestID = 0;
        return [session];
    }
    else if (SOEHeader == 0x3) {
        var ret = [];
        var offset = 2;
        while (offset < buf.length - 3) {
            len = buf.readUInt8(offset);
            ret.push(DecodeSOEPacket(buf.slice(offset + 1, offset + len + 1), true));
            offset += len + 1;
        }
        return ret;
    }
    else if (SOEHeader == 0x9) {
        var sequence = buf.readUInt16BE(2);
        if (sequence <= session.lastSequence && !module.exports.analyze) return [];
        session.lastSequence = sequence;
        var operands = buf.readUInt16LE(4);
        var opcode;
        if (operands == 0x1900) {
            var ret = [];
            var offset = 6;
            while (offset < buf.length - 3) {
                var len = buf.readUInt8(offset);
                offset++;
                operands = buf.readUInt16LE(offset);
                opcode = buf.readUInt32LE(offset + 2);
                if (!DecodeSWGPacket[opcode]) 
                    ret.push({type: opcode.toString(16) + " " + len});
                else
                    ret.push(DecodeSWGPacket[opcode](buf.slice(offset + 6, offset + len)));
                offset += len;
            }
            return ret;
        }
        opcode = buf.readUInt32LE(6);
        len = buf.length - 7;
        if (!DecodeSWGPacket[opcode]) return [{type: opcode.toString(16) + " " + len}];
        return [DecodeSWGPacket[opcode](buf.slice(10, decrypted ? buf.length : -3))];
    }
    else if (SOEHeader == 0xd) {
        var sequence = buf.readUInt16BE(2);
        if (sequence <= session.lastSequence) return [];
        session.lastSequence = sequence;
        if (fragments == null) {
            fragmentLength = buf.readUInt32BE(4);
            fragments = buf.slice(8,-3);
        } else {
            fragments = Buffer.concat([fragments, buf.slice(4, -3)]);
            console.log("fragment", fragments.length , "/", fragmentLength);
            if (fragments.length == fragmentLength) {
                buf = fragments;
                fragments = null;
                //console.log(buf.toString('hex'));
                //console.log(buf.toString('utf16le'));
                var operands = buf.readUInt16LE(0);
                opcode = buf.readUInt32LE(2);
                if (!DecodeSWGPacket[opcode]) return [{type: opcode.toString(16) + " " + buf.length}];
                var ret = [DecodeSWGPacket[opcode](buf.slice(6))];
                return ret;
            } else if (fragments.length > fragmentLength) {
                console.log("extra data fragment", fragments.length , "/", fragmentLength);
                fragments = null;
            }
        }
        return [];
    }
    else if (SOEHeader == 0x15) {
        return [{type: "Ack", sequence: buf.readUInt16BE(2)}];
    }
}

module.exports.Encode = function(type, data) {
    return EncodeSWGPacket[type](data);
}

function Decrypt(bufData)
{
    var decrypted = new Buffer(bufData.length);
    decrypted.writeUInt16BE(bufData.readUInt16BE(0), 0);

    var mask = session.CRCSeed;
    //console.log(mask.toString(16));
    var offset = 2;
    for (; offset <= bufData.length - 6; offset += 4) {
        let temp = bufData.readUInt32LE(offset);
        decrypted.writeUInt32LE((temp ^ mask) >>> 0, offset);
        mask = temp;
    }

    mask &= 0xff;

    for (; offset < bufData.length -2; offset++) {
        decrypted.writeUInt8((bufData.readUInt8(offset) ^ mask) >>> 0, offset);
    }

    decrypted.writeUInt16BE(bufData.readUInt16BE(offset), offset);
    //console.log(decrypted.toString('hex'));
    if (decrypted.readUInt8(decrypted.length-3) == 1)
        return Buffer.concat([decrypted.slice(0,2), zlib.inflateSync(decrypted.slice(2, -3)), decrypted.slice(-3)]);
    return decrypted;
}

function Encrypt(bufData) {
    if (bufData.length > 493) {
        var packets = [];
        //console.log(buf.toString('hex'));
        //console.log(buf.toString('utf16le'));
        var swgPacketSize = 496 - 8 - 3;
        for (var i = 4; i < bufData.length; i += swgPacketSize) {
            var head = new Buffer(i == 4 ? 8 : 4);
            head.writeUInt16BE(0xd, 0);
            head.writeUInt16BE(i > 4 ? session.sequence++ : session.sequence-1, 2);
            if (i == 4) head.writeUInt32BE(bufData.length-4, 4);
            else swgPacketSize = 496 - 4 - 3;
            var b = Buffer.concat([head, bufData.slice(i, i+swgPacketSize)]);
            //console.log(b.toString('hex'));
            packets.push(Encrypt(b));
        }
        return packets;
    }
    if (bufData.length > 100 || bufData.readUInt16BE(0) == 0xd)
        bufData = Buffer.concat([bufData.slice(0,2), zlib.deflateSync(bufData.slice(2)), Buffer.from([1,0,0])]);
    else
        bufData = Buffer.concat([bufData, Buffer.from([0,0,0])]);
    console.log(bufData.toString('hex'));
    var encrypted = new Buffer(bufData.length);
    encrypted.writeUInt16BE(bufData.readUInt16BE(0), 0);

    var mask = session.CRCSeed;
    var offset = 2;
    for (; offset <= encrypted.length - 6; offset += 4) {
        mask = (bufData.readUInt32LE(offset) ^ mask) >>> 0;
        encrypted.writeUInt32LE(mask, offset);
    }

    mask &= 0xff;

    for (; offset < encrypted.length - 2; offset++) {
        encrypted.writeUInt8((bufData.readUInt8(offset) ^ mask) >>> 0, offset);
    }

    encrypted.writeUInt16BE(GenerateCrc(encrypted.slice(0,offset), session.CRCSeed) & 0xffff, offset);

    return encrypted;
}

function EncodeSOEHeader(opcode, operands) {
    var buf = new Buffer(10);
    buf.writeUInt16BE(9, 0);
    buf.writeUInt16BE(session.sequence++, 2);
    buf.writeUInt16LE(operands, 4);
    buf.writeUInt32LE(opcode, 6);
    return buf;
}

DecodeSWGPacket = {};
EncodeSWGPacket = {};
EncodeSWGPacket["Ack"] = function(data) {
    if (session.lastAck >= session.lastSequence) return false;
    var buf = new Buffer(4);
    buf.writeUInt16BE(0x15, 0);
    buf.writeUInt16BE(session.lastSequence, 2);
    session.lastAck = session.lastSequence;
    return Encrypt(buf);
}

EncodeSWGPacket["NetStatusRequest"] = function(data) {
    var buf = new Buffer(4);
    buf.writeUInt16BE(0x7, 0);
    buf.writeUInt16BE(0, 2);
    return Encrypt(buf);
}

EncodeSWGPacket["SessionRequest"] = function() {
    var buf = new Buffer(14);
    buf.writeUInt16BE(1, 0);
    buf.writeUInt32BE(2, 2);
    buf.writeUInt32BE(crypto.randomBytes(4).readUInt32BE(0), 6);
    buf.writeUInt32BE(496, 10);
    return buf;
}

DecodeSWGPacket[0xd5899226] = function(data) {
    var ret = {type: "ClientIdMsg"};
    //console.log("4x0: " + data.slice(0, 4).toString('hex'));
    var len = data.readUInt32LE(4);
    ret.SessionKey = data.slice(8, 8+len);
    data.off = 8+len;
    ret.Version = AString(data);
    session.SessionKey = ret.SessionKey
    return ret;
}
EncodeSWGPacket["ClientIdMsg"] = function(data) {
    var header = EncodeSOEHeader(0xd5899226, 3);
    var buf = new Buffer(496);
    buf.fill(0,0,4);
    buf.off = 4;
    buf.writeUInt32LE(session.SessionKey.length, 4);
    session.SessionKey.copy(buf, 8);
    buf.off = 8 + session.SessionKey.length;
    writeAString(buf, "20050408-18:00");
    buf = buf.slice(0, buf.off);
    buf = Buffer.concat([header, buf]);
    return Encrypt(buf);
}

DecodeSWGPacket[0x31805ee0] = function(data) {
    return {type: "LagRequest"};
}
DecodeSWGPacket[0x1590f63c] = function(data) {
    return {type: "ConectionServerLagResponse"};
}
DecodeSWGPacket[0x789a4e0a] = function(data) {
    return {type: "GameServerLagResponse"};
}
DecodeSWGPacket[0xe00730e5] = function(data) {
    return {type: "ClientPermissions",
        GalaxyOpenFlag: data.readUInt8(0),
        CharacterSlotOpenFlag: data.readUInt8(1),
        UnlimitedCharCreationFlag: data.readUInt8(2)
    }
}
DecodeSWGPacket[0xc5ed2f85] = function(data) {
    return {type: "LagReport",
        ConnectionServerLag: data.readUInt32LE(0),
        GameServerLag: data.readUInt32LE(4)
    }
}
DecodeSWGPacket[0xb5098d76] = function(data) {
    return {type: "SelectCharacter",
        CharacterID: data.toString("hex")
    }
}
EncodeSWGPacket["SelectCharacter"] = function(data) {
    var header = EncodeSOEHeader(0xb5098d76, 2);
    var buf = new Buffer(8);
    data.CharacterID.copy(buf,0);
    buf = Buffer.concat([header, buf]);
    return Encrypt(buf);
}


DecodeSWGPacket[0x41131f96] = function(data) {
    data.off = 0;
    return {type: "LoginClientID",
        Username: AString(data),
        Password: AString(data),
        Version: AString(data)
    }
}
EncodeSWGPacket["LoginClientID"] = function(data) {
    var header = EncodeSOEHeader(0x41131f96, 4);
    var buf = new Buffer(496);
    buf.off = 0;
    writeAString(buf, data.Username);
    writeAString(buf, data.Password);
    writeAString(buf, "20050408-18:00");
    buf = buf.slice(0, buf.off);
    buf = Buffer.concat([header, buf]);
    return Encrypt(buf);
}

DecodeSWGPacket[0xaab296c6] = function(data) {
    var len = data.readUInt32LE(0);
    var ret = {type: "LoginClientToken",
        SessionKey: data.slice(4,len+4),
        StationID: data.readUInt32LE(len+4).toString(16)
    }
    data.off = len + 8;
    ret.UserName = AString(data);
    session.SessionKey = ret.SessionKey;
    return ret;
}
DecodeSWGPacket[0xc11c63b9] = function(data) {
    var ret = {type: "LoginEnumCluster",
        Servers: {}
    }
    var serverCount = data.readUInt32LE(0);
    data.off = 4;
    for (var i = 0; i < serverCount; i++) {
        var server = {ServerID: data.readUInt32LE(data.off).toString(16)};
        data.off += 4;
        server.Name = AString(data);
        server.Distance = data.readInt32LE(data.off);
        data.off += 4;
        ret.Servers[server.ServerID] = server;
    }
    ret.MaxCharsPerAccount = data.readUInt32LE(data.off);
    return ret;
}
DecodeSWGPacket[0x3436aeb6] = function(data) {
    var ret = {type: "LoginClusterStatus",
        Servers: {}
    };
    var serverCount = data.readUInt32LE(0);
    data.off = 4;
    for (var i = 0; i < serverCount; i++) {
        var server = {};
        var ServerID = data.readUInt32LE(data.off).toString(16);
        data.off += 4;
        server.IPAddress = AString(data);
        server.Port = data.readUInt16LE(data.off);
        server.PingPort = data.readUInt16LE(data.off+2);
        server.ServerPopulation = data.readInt32LE(data.off+4);
        server.MaxCapacity = data.readInt32LE(data.off+8);
        server.MaxCharsPerServer = data.readInt32LE(data.off+12);
        server.Distance = data.readInt32LE(data.off+16);
        server.Status = data.readInt32LE(data.off+20);
        server.NotRecommended = data.readInt8(data.off+24);
        data.off += 25;
        ret.Servers[ServerID] = server;
    }
    return ret;
}
DecodeSWGPacket[0x65ea4574] = function(data) {
    var raceGenderLookup = {
        0x060E51D5: "human male",
        0x04FEC8FA: "trandoshan male",
        0x32F6307A: "twilek male",
        0x9B81AD32: "bothan male",
        0x22727757: "zabrak male",
        0xCB8F1F9D: "rodian male",
        0x79BE87A9: "moncal male",
        0x2E3CE884: "wookiee male",
        0x1C95F5BC: "sullstan male",
        0xD3432345: "ithorian male",
        0xD4A72A70: "human female",
        0x64C24976: "trandoshan female",
        0x6F6EB65D: "twilek female",
        0xF6AB978F: "bothan female",
        0x421ABB7C: "zabrak female",
        0x299DC0DA: "rodian female",
        0x73D65B5F: "moncal female",
        0x1AAD09FA: "wookiee female",
        0x44739CC1: "sullstan female",
        0xE7DA1366: "ithorian female"
    };
    var ret = {type: "EnumerateCharacterId",
        Characters: {}
    };
    var characterCount = data.readUInt32LE(0);
    data.off = 4;
    for (var i = 0; i < characterCount; i++) {
        var name = UString(data);
        var raceGender = raceGenderLookup[data.readUInt32LE(data.off)];
        if (!raceGender) raceGender = "unknown unknown";
        raceGender = raceGender.split(" ");
        ret.Characters[name] = {
            Name: name,
            Race: raceGender[0],
            Gender: raceGender[1],
            CharacterID: data.slice(data.off+4, data.off+12),
            ServerID: data.readUInt32LE(data.off+12).toString(16),
            Satus: data.readUInt32LE(data.off+16)
        };
        data.off += 20;
    }
    return ret;
}

DecodeSWGPacket[0x20e4dbe3] = function(data) {
    data.off = 0;
    return {type: "ChatSendToRoom",
        Message: UString(data),
        Spacer: data.readUInt32LE(data.off),
        RoomID: data.readUInt32LE(data.off+4),
        MessageCounter: data.readUInt32LE(data.off+8)
    }
}
messageCounter = 1;
EncodeSWGPacket["ChatSendToRoom"] = function(data) {
    var buf = Buffer.concat([EncodeSOEHeader(0x20e4dbe3, 5), new Buffer(data.Message.length * 2 + 16)]);
    buf.off = 10;
    writeUString(buf, data.Message);
    buf.fill(0, buf.off, buf.off+4);
    buf.writeUInt32LE(data.RoomID, buf.off+4);
    buf.writeUInt32LE(messageCounter++, buf.off+8);
    //console.log(buf.toString('hex'));
    return Encrypt(buf);
}

tellCounter = 1;
EncodeSWGPacket["ChatInstantMessageToCharacter"] = function(data) {
    var buf = Buffer.concat([EncodeSOEHeader(0x84bb21f7, 5), new Buffer(21 + data.ServerName.length + data.PlayerName.length + data.Message.length * 2)]);
    buf.off = 10;
    writeAString(buf, "SWG");
    writeAString(buf, data.ServerName);
    writeAString(buf, data.PlayerName);
    writeUString(buf, data.Message);
    buf.fill(0, buf.off, buf.off+4);
    buf.writeUInt32LE(tellCounter++, buf.off+4);
    //console.log(buf.toString('hex'));
    return Encrypt(buf);
}

DecodeSWGPacket[0x88dbb381] = function(data) {
    var errorCode = data.readUInt32LE(0);
    var status = "Error";
    if (errorCode == 0) status = "Success";
    if (errorCode == 4) status = "Unavailable";
    return {type:"ChatOnSendInstantMessage", Status: status};
}

DecodeSWGPacket[0x3c565ced] = function(data) {
    data.off = 0;
    AString(data);//SWG
    AString(data);//server
    return {type:"ChatInstantMessageToClient", PlayerName: AString(data), Message: UString(data)};
}

DecodeSWGPacket[0xcd4ce444] = function(data) {
    data.off = 0;
    AString(data);//SWG
    AString(data);//server
    var ret = {type: "ChatRoomMessage",
        CharacterName: AString(data),
        RoomID: data.readUInt32LE(data.off)
    };
    data.off += 4;
    ret.Message = UString(data);
    ret.OutOfBandPackage = UString(data);
    return ret;
}
DecodeSWGPacket[0xe7b61633] = function(data) {
    return {type: "ChatOnSendRoom",
        ErrorCode: data.readUInt32LE(0),
        MessageID: data.readUInt32LE(4)
    }
}

DecodeSWGPacket[0x43fd1c22] = function(data) {
    return {type: "CmdSceneReady"};
}
EncodeSWGPacket["CmdSceneReady"] = function(data) {
    return Encrypt(EncodeSOEHeader(0x43fd1c22, 1));
}

DecodeSWGPacket[0xbc6bddf2] = function(data) {
    return {type: "ChatEnterRoomById",
        RequestID: data.readUInt32LE(0),
        RoomID: data.readUInt32LE(4)
    };
}
EncodeSWGPacket["ChatEnterRoomById"] = function(data) {
    var header = EncodeSOEHeader(0xbc6bddf2, 3);
    var buf = new Buffer(8);
    buf.writeUInt32LE(session.RequestID++, 0);
    buf.writeUInt32LE(data.RoomID, 4);
    buf = Buffer.concat([header, buf]);
    return Encrypt(buf);
}

DecodeSWGPacket[0xe69bdc0a] = function(data) {
    data.off = 0;
    AString(data);//SWG
    AString(data);//galaxy
    return {type: "ChatOnEnteredRoom",
        PlayerName: AString(data),
        Error: data.readUInt32LE(data.off),
        RoomID: data.readUInt32LE(data.off+4),
        RequestID: data.readUInt32LE(data.off+8)
    }
}

DecodeSWGPacket[0x9cf2b192] = function(data) {
    data.off=4;
    return {type: "ChatQueryRoom",
        RequestID: data.readUInt32LE(0),
        RoomPath: AString(data)
    };
}
EncodeSWGPacket["ChatQueryRoom"] = function(data) {
    var header = EncodeSOEHeader(0x9cf2b192, 3);
    var buf = new Buffer(496);
    buf.writeUInt32LE(session.RequestID++, 0);
    buf.off = 4;
    writeAString(buf, data.RoomPath);
    buf = Buffer.concat([header, buf.slice(0, buf.off)]);
    return Encrypt(buf);
}

DecodeSWGPacket[0xc4de864e] = function(data) {
    var ret = {type: "ChatQueryRoomResults",
        Players: [],
        Invited: [],
        Moderators: [],
        Banned: []
    };
    var count = data.readUInt32LE(0);
    data.off = 4;
    for (var i = 0; i < count; i++) {
        AString(data);//swg
        AString(data);//galaxy
        ret.Players.push(AString(data));
    }
    var count = data.readUInt32LE(0);
    data.off += 4;
    for (var i = 0; i < count; i++) {
        AString(data);//swg
        AString(data);//galaxy
        ret.Invited.push(AString(data));
    }
    var count = data.readUInt32LE(0);
    data.off += 4;
    for (var i = 0; i < count; i++) {
        AString(data);//swg
        AString(data);//galaxy
        ret.Moderators.push(AString(data));
    }
    var count = data.readUInt32LE(0);
    data.off += 4;
    for (var i = 0; i < count; i++) {
        AString(data);//swg
        AString(data);//galaxy
        ret.Banned.push(AString(data));
    }
    ret.RequestID = data.readUInt32LE(data.off);
    ret.RoomID = data.readUInt32LE(data.off+4);
    ret.IsPublic = data.readUInt32LE(data.off+8) > 0;
    ret.IsModerated = data.readUInt8(data.off+12) > 0;
    data.off += 13;
    ret.RoomPath = AString(data);
    AString(data); //SWG
    AString(data); //galaxy
    ret.Owner = AString(data);
    AString(data); //SWG
    AString(data); //galaxy
    ret.Creator = AString(data);
    ret.Title = UString(data);
    return ret;
}

DecodeSWGPacket[0x70deb197] = function(data) {
    var ret = {type: "ChatRoomList",
        Rooms: {}
    };
    var count = data.readUInt32LE(0);
    data.off = 4;
    for (var i = 0; i < count; i++) {
        var room = {
            RoomID: data.readUInt32LE(data.off),
            IsPublic: data.readUInt32LE(data.off+4) > 0,
            IsModerated: data.readUInt8(data.off+8) > 0
        };
        data.off += 9;
        room.RoomPath = AString(data);
        AString(data); //SWG
        AString(data); //galaxy
        room.Owner = AString(data);
        AString(data); //SWG
        AString(data); //galaxy
        room.Creator = AString(data);
        room.Title = UString(data);
        var moderators = data.readUInt32LE(data.off);
        data.off += 4;
        room.Moderators = [];
        for (var m = 0; m < moderators; m++) {
            AString(data);//SWG
            AString(data);//galaxy
            room.Moderators.push(AString(data));
        }
        var users = data.readUInt32LE(data.off);
        data.off += 4;
        room.Users = [];
        for (var u = 0; u < users; u++) {
            AString(data);//SWG
            AString(data);//galaxy
            room.Users.push(AString(data));
        }
        ret.Rooms[room.RoomID] = room;
    }
    return ret;
}

DecodeSWGPacket[0x80ce5e46] = function(data) {
    return {type:"ObjectController", TODO: "Main event for interacting with world"}
}

DecodeSWGPacket[0xf898e25f] = function(data) {
    data.off = 0;
    return {type:"RequestCategories", Language: AString(data)}
}

DecodeSWGPacket[0x274f4e78] = function(data) {
    return {type:"NewTicketActivity", TicketID: data.readUInt32LE(0)}
}

DecodeSWGPacket[0x0f5d5325] = function(data) {
    return {type:"ClientInactivity", Flag: data.readUInt8(0)}
}

DecodeSWGPacket[0x4c3d2cfa] = function(data) {
    return {type:"ChatRequestRoomList"}
}

EncodeSWGPacket["ChatRequestRoomList"] = function(data) {
    return Encrypt(EncodeSOEHeader(0x4c3d2cfa, 1));
}

DecodeSWGPacket[0x2e365218] = function(data) {
    return {type:"ConnectPlayer"}
}

DecodeSWGPacket[0x35366bed] = function(data) {
    data.off = 4;
    return {type:"ChatCreateRoom",
        PermissionFlag: data.readUInt8(0),
        ModerationFlag: data.readUInt8(1),
        RoomPath: AString(data),
        RoomTitle: AString(data),
        RequestID: data.readUInt32LE(data.off)
    }
}
EncodeSWGPacket["ChatCreateRoom"] = function(data) {
    var header = EncodeSOEHeader(0x35366bed, 7);
    var buf = new Buffer(496);
    buf.writeUInt8(1, 0);
    buf.writeUInt8(0, 1);
    buf.off = 4;
    writeAString(buf, data.RoomPath);
    writeAString(buf, data.RoomTitle || "");
    buf.writeUInt32LE(session.RequestID++, buf.off);
    buf = Buffer.concat([header, buf.slice(0, buf.off+4)]);
    return Encrypt(buf);

}
DecodeSWGPacket[0x60b5098b] = function(data) {
    data.off = 0;
    AString(data); //SWG
    AString(data); //server
    return {type:"ChatOnLeaveRoom", PlayerName: AString(data), RoomID: data.readUInt32LE(data.off+4)}
}

DecodeSWGPacket[0x6137556f] = function(data) {
    return {type:"ConnectPlayerResponse"};
}

DecodeSWGPacket[0x35d7cc9f] = function(data) {
    var ret = {type: "ChatOnCreateRoom",
        Error: data.readUInt32LE(0),
        RoomID: data.readUInt32LE(4),
        IsPublic: !!data.readUInt32LE(8),
        IsModerated: !!data.readUInt8(12),
        Moderators: [],
        Users: []
    };
    data.off = 13;
    ret.RoomPath = AString(data);
    AString(data); //SWG
    AString(data); //server
    ret.Owner = AString(data);
    AString(data); //SWG
    AString(data); //server
    ret.Creator = AString(data);
    ret.Title = UString(data);
    var moderators = data.readUInt32LE(data.off);
    data.off += 4;
    for (var i = 0; i < moderators; i++) {
        AString(data); //SWG
        AString(data); //server
        ret.Moderators.push(AString(data));
    }
    var users = data.readUInt32LE(data.off);
    data.off += 4;
    for (var i = 0; i < users; i++) {
        AString(data); //SWG
        AString(data); //server
        ret.Users.push(AString(data));
    }
    ret.RequestID = data.readUInt32LE(data.off);
    return ret;
}

function AString(buf) {
    var len = buf.readUInt16LE(buf.off);
    var str = buf.slice(buf.off+2, buf.off+2+len).toString("ascii");
    buf.off += 2 + len;
    return str;
}
function UString(buf) {
    var len = buf.readUInt32LE(buf.off);
    var str = buf.slice(buf.off+4, buf.off+4+len*2).toString("utf16le");
    buf.off += 4 + len*2;
    return str;
}

function writeAString(buf, str) {
    buf.writeUInt16LE(str.length, buf.off);
    buf.write(str, buf.off + 2, str.length, "ascii");
    buf.off += 2 + str.length;
}
function writeUString(buf, str) {
    buf.writeUInt32LE(str.length, buf.off);
    buf.write(str, buf.off+4, str.length*2, "utf16le");
    buf.off += 4 + str.length*2;
}

function GenerateCrc(pData, nCrcSeed)
{
    const g_nCrcTable =
    [
    0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f,
    0xe963a535, 0x9e6495a3, 0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988,
    0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91, 0x1db71064, 0x6ab020f2,
    0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
    0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9,
    0xfa0f3d63, 0x8d080df5, 0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172,
    0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b, 0x35b5a8fa, 0x42b2986c,
    0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
    0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423,
    0xcfba9599, 0xb8bda50f, 0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924,
    0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d, 0x76dc4190, 0x01db7106,
    0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
    0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d,
    0x91646c97, 0xe6635c01, 0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e,
    0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457, 0x65b0d9c6, 0x12b7e950,
    0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7,
    0xa4d1c46d, 0xd3d6f4fb, 0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0,
    0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9, 0x5005713c, 0x270241aa,
    0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
    0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81,
    0xb7bd5c3b, 0xc0ba6cad, 0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a,
    0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683, 0xe3630b12, 0x94643b84,
    0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
    0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb,
    0x196c3671, 0x6e6b06e7, 0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc,
    0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5, 0xd6d6a3e8, 0xa1d1937e,
    0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
    0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55,
    0x316e8eef, 0x4669be79, 0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236,
    0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f, 0xc5ba3bbe, 0xb2bd0b28,
    0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
    0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f,
    0x72076785, 0x05005713, 0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38,
    0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21, 0x86d3d2d4, 0xf1d4e242,
    0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
    0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69,
    0x616bffd3, 0x166ccf45, 0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2,
    0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db, 0xaed16a4a, 0xd9d65adc,
    0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
    0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693,
    0x54de5729, 0x23d967bf, 0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94,
    0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
    ];

    var nCrc = g_nCrcTable[(~nCrcSeed) & 0xFF];
    nCrc ^= 0x00FFFFFF;
    var nIndex = (nCrcSeed >>> 8) ^ nCrc;
    nCrc = (nCrc >>> 8) & 0x00FFFFFF;
    nCrc ^= g_nCrcTable[nIndex & 0xFF];
    nIndex = (nCrcSeed >>> 16) ^ nCrc;
    nCrc = (nCrc >>> 8) & 0x00FFFFFF;
    nCrc ^= g_nCrcTable[nIndex & 0xFF];
    nIndex = (nCrcSeed >>> 24) ^ nCrc;
    nCrc = (nCrc >>> 8) &0x00FFFFFF;
    nCrc ^= g_nCrcTable[nIndex & 0xFF];

    for(var i = 0; i < pData.length; i++ )
    {
        nIndex = pData.readUInt8(i) ^ nCrc;
        nCrc = (nCrc >>> 8) & 0x00FFFFFF;
        nCrc ^= g_nCrcTable[nIndex & 0xFF];
    }
    return ~nCrc;
}
