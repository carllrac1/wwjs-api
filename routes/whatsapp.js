var express = require('express');
var router = express.Router();
var axios = require('axios');
var dotenv = require('dotenv');
var fs = require('fs');
var path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

router.get('/obtener-qr', function (req, res, next) {
    dotenv.config();
    const crmUrl = process.env.CRM_URL;
    const queryParams = req.query;
    const companyId = queryParams.company_id;
    const userId = queryParams.user_id;

    const compressedQueryParams = Buffer.from(JSON.stringify([companyId, userId])).toString('base64');

    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './whatsapp-sessions',
            clientId: '1234567890'
        })
    });

    client.on('ready', () => {
        console.log('Cliente listo');
        // console.log(client.info.wid.user);
    });

    client.on('auth_failure', (message) => {
        console.log('Error de autenticación', message);
    });

    client.on('qr', (qr) => {
        axios.post(crmUrl, {
            topic: 'qr_whatsapp',
            userId: userId,
            companyId: companyId,
            qr: qr
        }).then(response => {
            console.log('Se ha enviado el QR al CRM');
        }).catch(error => {
            console.error(error);
        });
    });

    client.initialize();

    res.send({ message: 'Generando QR...', status: 'success' });
});

module.exports = router;
