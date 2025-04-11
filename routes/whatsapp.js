var express = require('express');
var router = express.Router();
var axios = require('axios');
var dotenv = require('dotenv');
var fs = require('fs');
var path = require('path');
const { Client, LocalAuth, Poll, Buttons, MessageMedia } = require('whatsapp-web.js');
let clients = [];


let initializeConnection = (connectionId) => {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    dotenv.config();
    let client_registered = clients.find(client => client.connectionId === connectionId);
    if (!client_registered) {
        let client = new Client({
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--allow-insecure-localhost',
                    '--ignore-certificate-errors'
                ],
                executablePath: process.env.CHROME_PATH,
            },
            authStrategy: new LocalAuth({
                dataPath: './whatsapp-sessions',
                clientId: connectionId
            }),
        });

        client.on('ready', () => {
            axios.post(process.env.CRM_URL, {
                topic: 'qr_scanned',
                connectionId: connectionId,
                phoneNumber: client.info.wid.user
            }).then(response => {
                console.log('Se ha enviado el estado de conexión al CRM');
            }).catch(error => {
                console.error(error);
            });
        });

        client.on('message_create', async (message) => {
            message.chat = await message.getChat();
            message.contact = await message.getContact();
            message.additionalData = await message.getInfo();

            axios.post(process.env.CRM_URL, {
                topic: 'whatsapp_message',
                message: message,
                connectionId: connectionId
            }).then(response => {
                console.log('Se ha enviado el mensaje al CRM');
            }).catch(error => {
                console.error(error);
            })
        })

        client.on('qr', (qr) => {
            axios.post(process.env.CRM_URL, {
                topic: 'qr_whatsapp',
                qr: qr,
                connectionId: connectionId
            }).then(response => {
                console.log('Se ha enviado el QR al CRM');
            }).catch(error => {
                console.error(error);
            });
        });

        client.initialize();

        clients.push({ connectionId: connectionId, client: client });

        client_registered = client;
    } else {
        client_registered = client_registered.client;
    }

    return client_registered;
}

router.get('/obtener-qr', function (req, res, next) {
    let connectionId = req.query.connection_id;
    initializeConnection(connectionId);
    res.send({ message: 'Generando QR...', status: 'success' });
});

router.get('/obtener-chats', async function (req, res, next) {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

    const { connection_id, page, limit } = req.query;
    let client = await initializeConnection(connection_id);

    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo
    }

    let chats = await client.getChats();

    chats = await Promise.all(chats.map(async (chat) => {
        let contact = await chat.getContact();
        let profilePicUrl = null;

        if (contact.shortName != 'WhatsApp') {
            profilePicUrl = await contact.getProfilePicUrl();
        }

        let lastMessage = chat.lastMessage;
        if (lastMessage && lastMessage.type != 'gp2') {
            lastMessage.contact = await lastMessage.getContact();
        }
        return {
            chat: chat,
            contact: contact,
            profilePicUrl: profilePicUrl,
        }
    }));

    res.send({
        message: 'Lista de chats obtenida correctamente',
        status: 'success',
        chats: chats,
    });
});

router.get('/obtener-mensajes', async function (req, res, next) {
    const { connection_id, chat_id, limit } = req.query;
    let client = await initializeConnection(connection_id);

    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    let chat = await client.getChatById(chat_id);
    let messages = await chat.fetchMessages({ limit: parseInt(limit) });

    messages = await Promise.all(messages.map(async (message) => {
        let contact = await message.getContact();
        let additionalData = await message.getInfo();
        message.contact = contact;
        message.additionalData = additionalData;
        return message;
    }));

    res.send({
        message: 'Lista de mensajes obtenida correctamente',
        status: 'success',
        messages: messages,
    });

});

router.get('/obtener-media', async function (req, res, next) {
    const { connection_id, chat_id, message_id } = req.query;
    let client = await initializeConnection(connection_id);

    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const message = await client.getMessageById(message_id);
    let media = await message.downloadMedia();

    return res.send({
        message: 'Media obtenida correctamente',
        status: 'success',
        mediaMessage: media,
    });
})

router.post('/enviar-mensaje', async function (req, res, next) {

    const { connection_id, chat_id, message } = req.body;
    let client = await initializeConnection(connection_id);

    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 500));
    }


    if (message.media.length > 0) {
        console.log('Enviando mensaje con media...', message.media);
        for (const [key, value] of Object.entries(message.media)) {
            //check if is last element, if so, send message with caption
            if (key == message.media.length - 1) {
                const media = await MessageMedia.fromUrl(value.url);
                const messageSent = await client.sendMessage(chat_id, media, { caption: message.message, quotedMessageId: message.quotedMessageId });
                messageSent.chat = await messageSent.getChat();
                messageSent.contact = await messageSent.getContact();
                messageSent.additionalData = await messageSent.getInfo();
                return res.send({
                    message: 'Mensaje enviado correctamente',
                    status: 'success',
                    messageData: messageSent,
                });
            } else {
                const media = await MessageMedia.fromUrl(value.url);
                await client.sendMessage(chat_id, media);
            }
        }
    } else {
        const messageSent = await client.sendMessage(chat_id, message.message);
        messageSent.chat = await messageSent.getChat();
        messageSent.contact = await messageSent.getContact();
        messageSent.additionalData = await messageSent.getInfo();
        return res.send({
            message: 'Mensaje enviado correctamente',
            status: 'success',
            messageData: messageSent,
        });
    }
});

router.post('/enviar-encuesta', async function (req, res, next) {
    const { connection_id, chat_id, poll } = req.body;
    let client = await initializeConnection(connection_id);

    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const newPoll = new Poll(poll.name, poll.options, {
        allowMultipleAnswers: poll.allowMultipleAnswers,
    });

    const message = await client.sendMessage(chat_id, newPoll);

    res.send({
        message: 'Encuesta enviada correctamente',
        status: 'success',
        pollMessage: message,
    });
})

// deprecado
router.post('/enviar-boton', async function (req, res, next) {
    const { connection_id, chat_id, button } = req.body;

    let client = await initializeConnection(connection_id);
    while (!client.info) {
        console.log('Esperando a que el cliente esté disponible...');
        client = clients.find(client => client.connectionId === connection_id).client;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const buttonsObject = new Buttons('Hola',
        [
            { id: 'btn1', body: 'Botón 1' },
            { id: 'btn2', body: 'Botón 2' }
        ]
    )

    const message = await client.sendMessage(chat_id, buttonsObject);

    res.send({
        message: 'Botón enviado correctamente',
        status: 'success',
        buttonMessage: message,
    });
})

module.exports = router;

