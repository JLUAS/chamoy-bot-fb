// Importar las dependencias necesarias
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const axios = require('axios'); // Sustituto de request
const cors = require('cors');
const mysql = require('mysql');


// Configuración de multer para almacenar el archivo en memoria
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

async function reenviarMensaje(id, userId, texto) {
    console.log(`Reintentando envío del mensaje ID: ${id} para el usuario: ${userId}`);
    const messageData = {
        recipient: { id: userId },
        message: { text: texto },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE',
    };

    try {
        await callSendAPI(messageData);
    } catch (error) {
        console.error(`Error al enviar mensaje ID: ${id}`, error.message);
    }
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

// Función para insertar un mensaje en la base de datos
function insertarMensaje(userId, mensaje, enviado) {
    // Primero, verificar si el mensaje ya existe
    const checkQuery = 'SELECT * FROM Mensajes WHERE userId = ? AND mensaje = ?';
    
    pool.query(checkQuery, [userId, mensaje], (err, results) => {
        if (err) {
            console.error('Error al verificar el mensaje en la base de datos:', err.message);
            return;
        }
        
        // Si ya existe el mensaje, hacer un log
        if (results.length > 0) {
            console.log('Mensaje ya registrado.');
            return; // Si el mensaje ya existe, no insertamos nada
        }
        
        // Si el mensaje no existe, proceder a insertarlo
        const insertQuery = `INSERT INTO Mensajes (userId, mensaje, enviado, createdAt) VALUES (?, ?, ?, NOW())`;
        
        pool.query(insertQuery, [userId, mensaje, enviado], (err, results) => {
            if (err) {
                console.error('Error al insertar el mensaje en la base de datos:', err.message);
            } else {
                console.log('Mensaje insertado correctamente en la base de datos:', results.insertId);
            }
        });
    });
}

// Modificación en callSendAPI para manejar errores
async function callSendAPI(messageData) {
    try {
        const response = await axios.post(
            'https://graph.facebook.com/v21.0/me/messages',
            messageData,
            {
                params: { access_token: APP_TOKEN_M },
                headers: { 'Content-Type': 'application/json' }
            }
        );
        console.log('Mensaje enviado exitosamente:', response.data);
         // Eliminar el mensaje de la base de datos si el envío fue exitoso
         const userId = messageData.recipient.id;
         const mensaje = messageData.message.text;
         
         // Eliminar mensaje previamente insertado si ya existe
         const deleteQuery = 'DELETE FROM Mensajes WHERE userId = ? AND mensaje = ?';
         pool.query(deleteQuery, [userId, mensaje], (err, results) => {
             if (err) {
                 console.error('Error al eliminar el mensaje:', err.message);
             } else {
                 console.log('Mensaje eliminado correctamente de la base de datos.');
             }
         });
        return; // Salir del loop si se envía correctamente
    } catch (error) {
        if (error.response) {
                console.error('Error en la API de Messenger:', error.response.data);
                const userId = messageData.recipient.id; // ID del destinatario
                console.log(userId)
                const mensaje = messageData.message.text; // Contenido del mensaje
                insertarMensaje(userId, mensaje, false); // Guardar mensaje con enviado = false
        } else {
            console.error('Error al enviar el mensaje:', error.message);
        }
    }
}

// Función para revisar la base de datos y procesar mensajes pendientes
async function revisarMensajesPendientes() {
    console.log("Revisando mensajes pendientes...");
    const query = `SELECT id, userId, mensaje FROM Mensajes WHERE enviado = false`;

    pool.query(query, async (err, results) => {
        if (err) {
            console.error("Error al consultar la base de datos:", err.message);
            return;
        }

        if (results.length === 0) {
            console.log("No hay mensajes pendientes.");
            return;
        }

        console.log(`Se encontraron ${results.length} mensajes pendientes.`);

        // Procesar cada mensaje
        for (const mensaje of results) {
            const { id, userId, mensaje: texto } = mensaje;
            await reenviarMensaje(id, userId, texto);
        }
    });
}

// Configurar revisión cada hora
setInterval(revisarMensajesPendientes, 60 * 1000);

