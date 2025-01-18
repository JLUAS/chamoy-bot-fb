// Importar las dependencias necesarias
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const axios = require('axios'); // Sustituto de request

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Variables de entorno
const APP_TOKEN = process.env.APP_TOKEN;
const APP_TOKEN_M = process.env.APP_TOKEN_M;
const { Configuration, OpenAIApi } = require('openai');

// Inicializar OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const PORT = process.env.PORT || 3000;

// Iniciar servidor
app.listen(PORT, function () {
    console.log(`Server listening on localhost:${PORT}`);
});

// Endpoint de prueba
app.get('/', function (req, res) {
    res.send('Servidor corriendo correctamente. Accede a través de http://ngrok.com');
});

// Verificación del webhook
app.get('/webhook', function (req, res) {
    if (req.query['hub.verify_token'] === APP_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Token de verificación inválido.');
    }
});

// Webhook para recibir mensajes
app.post('/webhook', async (req, res) => {
    const data = req.body;
    if (data.object === 'page') {
        data.entry.forEach((entry) => {
            if (entry.changes && Array.isArray(entry.changes)) {
                entry.changes.forEach((change) => {
                    if (change.field === 'feed' && change.value.item === 'comment') {
                        const commentText = change.value.message;
                        const commenterId = change.value.from.id;
                        const commenterName = change.value.from.name;

                        console.log(`Comentario recibido: "${commentText}" de ${commenterName} (${commenterId})`);

                        // Generar una respuesta con OpenAI
                        openai.chat.completions.create({
                            model: 'ft:gpt-4o-mini-2024-07-18:personal::AbFUH44f',
                            messages: [
                                { role: 'system', content: `Eres un asistente profesional para responder comentarios en Facebook de la empresa Chamoy la Avispa. Responde al comentario de manera personalizada.` },
                                { role: 'user', content: `Comentario: "${commentText}", Nombre: "${commenterName}"` },
                            ],
                        })
                        .then((response) => {
                            const reply = response.choices[0].message.content;
                            enviarMensajeTexto(commenterId, reply);
                        })
                        .catch((err) => {
                            console.error('Error al generar respuesta con OpenAI:', err.message);
                        });
                    }
                });
            }
        });
    }

    res.sendStatus(200);
});

// Procesar mensajes entrantes
function getMessage(event) {
    const senderID = event.sender.id;
    const messageText = event.message.text;
    evaluarMensaje(senderID, messageText);
}

async function evaluarMensaje(senderID, messageText) {
    openai.chat.completions.create({
        model: 'ft:gpt-4o-mini-2024-07-18:personal::AbFUH44f',
        messages: [
            { role: 'system', content: `Eres un asistente profesional para responder a posibles clientes de la empresa Chamoy la Avispa.` },
            { role: 'user', content: `${messageText}` },
        ],
    })
    .then((response) => {
        const extractedResponse = response.choices[0].message.content;
        enviarMensajeTexto(senderID, extractedResponse);
    })
    .catch((err) => {
        console.error('Error al procesar OpenAI:', err.message);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Enviar mensajes de texto a Messenger
async function enviarMensajeTexto(senderID, mensaje) {
    const messageData = {
        recipient: {
            id: senderID
        },
        message: {
            text: mensaje
        },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE' // Cambiar etiqueta según el caso
    };
    await callSendAPI(messageData);
}

async function callSendAPI(messageData) {
    try {
        console.log("Enviando mensaje:", messageData);
        const response = await axios.post(
            'https://graph.facebook.com/v21.0/me/messages',
            messageData,
            {
                params: { access_token: APP_TOKEN_M },
                headers: { 'Content-Type': 'application/json' }
            }
        );
        console.log('Mensaje enviado exitosamente:', response.data);
    } catch (error) {
        if (error.response) {
            console.error('Error en la API de Messenger:', error.response.data);
            await callSendAPI2(messageData);
        } else {
            console.error('Error al enviar el mensaje:', error.message);
        }
    }
}

async function callSendAPI2(messageData) {
    await delay(600000);
    await callSendAPI(messageData);
}
