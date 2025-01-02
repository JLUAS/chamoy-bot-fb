const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const dotenv = require('dotenv')
const { OpenAI } = require('openai'); // Usando la API de OpenAI
const app = express();
app.use(bodyParser.json());

require('dotenv').config();

const { Configuration, OpenAIApi } = require('openai');

// Accede a las claves desde process.env
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Inicializa OpenAI con tu clave de API desde el archivo .env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Usando la clave de la variable de entorno
  });

// Webhook para recibir eventos de Facebook
app.post('/webhook', async (req, res) => {
    const event = req.body.entry?.[0]?.changes?.[0]?.value;

    if (event && event.item === 'comment' && event.verb === 'add') {
        const commentId = event.comment_id;
        const commentText = event.message;

        // Generar respuesta con OpenAI
        const response = await openai.createCompletion({
            model: 'text-davinci-003',
            prompt: `Eres un asistente profesional para responder comentarios en Facebook. Responde: "${commentText}"`,
            max_tokens: 100,
        });

        const reply = response.data.choices[0].text.trim();

        // Publicar respuesta en Facebook
        await axios.post(
            `https://graph.facebook.com/v12.0/${commentId}/comments`,
            { message: reply },
            { headers: { Authorization: `Bearer ${PAGE_ACCESS_TOKEN}` } }
        );
    }

    res.sendStatus(200);
});

// Verificación del webhook
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = 'mi_token_secreto_123';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.listen(3000, () => console.log('Servidor corriendo en puerto 3000'));
