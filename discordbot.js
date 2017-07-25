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
        if (message.channel.name != config.Discord.ChatChannel) return;
        if (message.author.username == config.Discord.BotName) return;
        SWG.sendChat(message.cleanContent, server.members.get(message.author.id).displayName);
    });

    client.on('disconnect', event => setTimeout(discordBot, 60000));

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
            setTimeout(discordBot, 60000);
        });
}
discordBot();

SWG.serverDown = function() {
    notif.send(notifRole + " server DOWN");
}

SWG.serverUp = function() {
    notif.send(notifRole + " server UP!");
}

SWG.recvChat = function(message, player) {
    chat.send("**" + player + ":**  " + message);
}