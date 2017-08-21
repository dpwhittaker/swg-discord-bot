const Discord = require('discord.js');
const SWG = require('./swgclient');
const config = require('./config');
SWG.login(config.SWG);

var client, server, notif, chat, notifRole;
function discordBot() {
    client = new Discord.Client();

    client.on('message', message => {
        if (message.content.startsWith('!server')) {
            message.reply(SWG.isConnected ? "The server is UP!" : "The server is DOWN :(");
        }
        if (message.content.startsWith('!fixchat')) {
            message.reply("rebooting chat bot");
            process.exit(0);
        }
        if (message.content.startsWith('!pausechat')) {
            message.reply(SWG.paused ? "unpausing" : "pausing");
            SWG.paused = !SWG.paused;
        }
        if (message.channel.name != config.Discord.ChatChannel) return;
        if (message.author.username == config.Discord.BotName) return;
        SWG.sendChat(message.cleanContent, server.members.get(message.author.id).displayName);
    });

    client.on('disconnect', event => {
        try {notif.send("RoC-Bot disconnected");}catch(ex){}
        client = server = notif = chat = notifRole = null;
        console.log("Discord disconnect: " + JSON.stringify(event,null,2));
        setTimeout(discordBot, 1000);
    });

    client.login(config.Discord.BotToken)
        .then(t => {
            client.user.setPresence({ status: "online", game: {name: "Progor-Chat"}});
            server = client.guilds.find("name", config.Discord.ServerName);
            notif = server.channels.find("name", config.Discord.NotificationChannel);
            chat = server.channels.find("name", config.Discord.ChatChannel);
            notifRole = server.roles.find("name", config.Discord.NotificationMentionRole);
        })
        .catch(reason => {
            console.log(reason);
            setTimeout(discordBot, 1000);
        });
}
discordBot();

SWG.serverDown = function() {
    if (notif) notif.send(notifRole + " server DOWN");
}

SWG.serverUp = function() {
    if (notif) notif.send(notifRole + " server UP!");
}

SWG.reconnected = function() {
    if (chat) chat.send("chat bot reconnected");
}

SWG.recvChat = function(message, player) {
    console.log("sending chat to discord " + player + ": " + message);
    if (chat) chat.send("**" + player + ":**  " + message);
    else console.log("discord disconnected");
}

SWG.recvTell = function(from, message) {
    console.log("received tell from: " + from + ": " + message);
    if (from != config.SWG.Character) SWG.sendTell(from, "Hi!");
}

setInterval(() => SWG.sendTell(config.SWG.Character, "ping"), 30000);