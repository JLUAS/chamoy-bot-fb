const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const axios = require('axios'); // Sustituto de request
const cors = require('cors');
const mysql = require('mysql');

dotenv.config({ path: './.env' });

const app = express();
app.use(cors());

const dbConfig = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
  connectionLimit: 10,
};

const pool = mysql.createPool(dbConfig);

pool.on('connection', (connection) => {
  console.log('New connection established with ID:', connection.threadId);
});

pool.on('acquire', (connection) => {
  console.log('Connection %d acquired', connection.threadId);
});

pool.on('release', (connection) => {
  console.log('Connection %d released', connection.threadId);
});

pool.on('error', (err) => {
  console.error('MySQL error: ', err);
});

function handleDisconnect() {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('Error getting connection: ', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      connection.release();
      console.log('MySQL connected');
    }
  });
}

handleDisconnect();


dotenv.config();

app.use(bodyParser.json());

// Variables de entorno
const APP_TOKEN = process.env.APP_TOKEN;
const APP_TOKEN_M = process.env.APP_TOKEN_M;
const APP_TOKEN_IG = process.env.APP_TOKEN_IG;
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
    if (data.object === 'instagram') {
        data.entry.forEach((entry) => {
            entry.changes.forEach(async (change) => {
                if (change.field === 'comments' && change.value.item === 'comment') {
                    const commentData = change.value;
                    const commentText = commentData.text;
                    const mediaId = commentData.media.id;
                    const commentId = commentData.comment_id;
                    const username = commentData.username;

                    console.log(`Comentario de Instagram: ${commentText} de @${username}`);

                    try {
                        const gptResponse = await openai.chat.completions.create({
                            model: 'ft:gpt-3.5-turbo-1106:personal:chamoy-number:AwFSZoJI',
                            messages: [
                                { 
                                    role: 'system', 
                                    content: "Mismo sistema que para Facebook..." 
                                },
                                { 
                                    role: 'user', 
                                    content: `Comentario: "${commentText}", Usuario: @${username}` 
                                },
                            ],
                        });

                        const respuesta = gptResponse.choices[0].message.content;
                        await responderComentarioInstagram(mediaId, respuesta);
                    } catch (err) {
                        console.error('Error:', err.message);
                    }
                }
            });
        });
    }
    if (data.object === 'page') {
        data.entry.forEach((entry) => {
            if (entry.changes && Array.isArray(entry.changes)) {
                entry.changes.forEach(async (change) => {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.from.name != "Chamoy Avispa" && change.value.message != undefined) {
                        const commentText = change.value.message;
                        const commentId = change.value.comment_id; // ID del comentario
                        const commenterName = change.value.from.name;

                        console.log(`Comentario recibido: "${commentText}" de ${commenterName}`);

                        try {
                            const gptResponse = await openai.chat.completions.create({
                                model: 'ft:gpt-3.5-turbo-1106:personal:chamoy-number:AwFSZoJI',
                                messages: [
                                    { role: 'system', content:  "Eres el asistente oficial de la página de Facebook de Chamoy La Avispa. Responde de manera amigable y profesional a los comentarios de los clientes.  - Si preguntan por el número de contacto, proporciona el siguiente: 8131056733.  - Si preguntan cómo se usa el producto, dales el mismo número para obtener más información.  - No vendemos en tiendas departamentales. Si alguien pregunta dónde comprar, infórmales que pueden ver todos los distribuidores en este enlace: https://chamoyavispa.com/#/distribuidores.  - No proporciones direcciones exactas. Siempre redirige a la página de distribuidores.  - Si no sabes la respuesta a una pregunta, responde con un mensaje amable sugiriendo que contacten por WhatsApp al número proporcionado.  - Usa un tono respetuoso, cálido y breve en tus respuestas." },
                                    { role: 'user', content: `Comentario: "${commentText}", Nombre: "${commenterName}"` },
                                ],
                            });

                            const respuesta = gptResponse.choices[0].message.content;

                            await responderComentario(commentId, respuesta);
                        } catch (err) {
                            console.error('Error al procesar el comentario:', err.message);
                        }
                    }
                });
            }
            if (entry.messaging) {
                entry.messaging.forEach(async (event) => {
                    const senderId = event.sender.id;
                    const message = event.message?.text;
                    const id = process.env.PAGE_ID
                    if (message && senderId != id ) {
                        console.log(`Mensaje recibido: "${message}" de ${senderId}`);

                        // Generar una respuesta con OpenAI
                        try {
                            const gptResponse = await openai.chat.completions.create({
                                model: 'ft:gpt-3.5-turbo-1106:personal:chamoy:Av84mh4o',
                                messages: [
                                    { role: 'system', content: 'Eres un asistente profesional que responde mensajes de usuarios en Messenger de forma efectiva.' },
                                    { role: 'user', content: `Mensaje: "${message}"` },
                                ],
                            });

                            const respuesta = gptResponse.choices[0].message.content;

                            // Enviar respuesta al usuario
                            await enviarMensaje(senderId, respuesta);
                        } catch (err) {
                            console.error('Error al procesar el mensaje:', err.message);
                        }
                    }
                });
            }
        });
    }

    res.sendStatus(200);
});


app.post('/IA', async(req,res) => {
    const{userSpeech} = req.body
    const gptResponse = await openai.chat.completions.create({
        model: "ft:gpt-4o-mini-2024-07-18:personal::AbFUH44f",
        messages: [
          { role: "system", content: "Eres un asistente del banco Getnet especializado en terminales de pago." },
          { role: "user", content: userSpeech },
        ],
      });
  
      const botResponse = gptResponse.choices[0].message.content;
      res.send(botResponse)
})

async function responderComentarioInstagram(mediaId, mensaje) {
    const url = 'https://graph.instagram.com/v21.0/me/messages';

    const data = {
        recipient: { id: recipientId }, // ID del usuario de Messenger
        message: { text: mensaje },    // Mensaje a enviar
    };

    try {
        const response = await axios.post(url, data,{
            params: {
                access_token: APP_TOKEN_IG, // Token con permisos de páginas
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Respuesta publicada en Instagram:', response.data);
    } catch (error) {
        console.error('Error en Instagram:', error.response?.data || error.message);
    }
}   

// Función para responder a un comentario en Facebook
async function responderComentario(commentId, mensaje) {
    const url = `https://graph.facebook.com/v15.0/${commentId}/comments`;

    const data = {
        message: mensaje,
    };

    try {
        const response = await axios.post(url, data, {
            params: {
                access_token: APP_TOKEN_M, // Token con permisos de páginas
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Respuesta publicada exitosamente:', response.data);
    } catch (error) {
        if (error.response) {
            console.error('Error al responder comentario:', error.response.data);
        } else {
            console.error('Error al realizar la solicitud:', error.message);
        }
    }
}

// Función para enviar mensajes directos a través de Messenger
async function enviarMensaje(recipientId, mensaje) {
    const url = `https://graph.facebook.com/v15.0/me/messages`;

    const data = {
        recipient: { id: recipientId }, // ID del usuario de Messenger
        message: { text: mensaje },    // Mensaje a enviar
    };

    try {
        const response = await axios.post(url, data, {
            params: {
                access_token: APP_TOKEN_M, // Token con permisos de Messenger
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Mensaje enviado exitosamente:', response.data);
    } catch (error) {
        if (error.response) {
            console.error('Error al enviar mensaje:', error.response.data);
        } else {
            console.error('Error al realizar la solicitud:', error.message);
        }
    }
}
