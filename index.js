const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const request = require('request')
const dotenv = require('dotenv')
const { OpenAI } = require('openai'); // Usando la API de OpenAI
const app = express();
app.use(bodyParser.json());

require('dotenv').config();

const APP_TOKEN = process.env.APP_TOKEN
const { Configuration, OpenAIApi } = require('openai');

// Accede a las claves desde process.env
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Inicializa OpenAI con tu clave de API desde el archivo .env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Usando la clave de la variable de entorno
  });

  var PORT = process.env.PORT || 3000;

  app.listen(PORT,function(){
	console.log('Server listen localhost:3000')
})

app.get('/',function(req, res){
	res.send('Abriendo el puerto desde mi pc Local con http://ngrok.com')
})

app.get('/webhook',function(req, res){
	if(req.query['hub.verify_token'] === APP_TOKEN){
		res.send(req.query['hub.challenge'])
	}else{
		res.send('Tu no tienes que entrar aqui')
	}
})

// app.post('/webhook',function(req, res){
// 	var data = req.body
// 	if(data.object == 'page'){
// 		data.entry.forEach(function(pageEntry){
// 			pageEntry.messaging.forEach(function(messagingEvent){
// 				if(messagingEvent.message){	
//                     console.log("Mensjae recibido, procesando a get message")				
// 					getMessage(messagingEvent)
// 				}
// 			})
// 		})
// 	}
// 	res.sendStatus(200)
// })

app.post('/webhook', async (req, res) => {
    const data = req.body;
    if (data.object === 'page') {
        data.entry.forEach((entry) => {
            if (entry.changes && Array.isArray(entry.changes)) {
                entry.changes.forEach((change) => {
                    if (change.field === 'feed' && change.value.item === 'comment') {
                        const postId = change.value.post_id; // ID del post relacionado
                        enviarMensajeConBotones(postId); // Responder al comentario con botones
                    }
                });
            }
        });
    }
    res.sendStatus(200);
});



function getMessage(event){
	var senderID = event.sender.id
	var messageText = event.message.text

	evaluarMensaje(senderID, messageText)
}

async function evaluarMensaje(senderID, messageText){

    // Generar respuesta con OpenAI
    openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // o el modelo que prefieras
        messages: [
          { role: 'system', content: `Eres un asistente profesional para responder a posibles clientes de la empresa Chamoy la Avispa.` },
          { role: 'user', content: `${messageText}` },
        ]
      }).then(response => {
        const extractedResponse = response.choices[0].message.content;
        enviarMensajeTexto(senderID, extractedResponse)
      }).catch((err) => {
        console.error("Error al procesar openAI")
        res.status(500).json({ error: 'Error al procesar con OpenAI' });
      })
}


//enviar texto plano
function enviarMensajeTexto(senderID, mensaje){
	var messageData = {
		recipient : {
			id: senderID
		},
		message: {
			text: mensaje,
		}
	}

	callSendAPI(messageData)
}

function callSendAPI(messageData){
	//api de facebook
	request({
		uri: 'https://graph.facebook.com/v2.6/500155363187033/messages',
		qs: {access_token: APP_TOKEN},
		method: 'POST',
		json: messageData
	},function(error, response, data){
		if(error)
			console.log('No es posible enviar el mensaje')
		else
			console.log('Mensaje enviado', messageData)
	})
}

function enviarMensajeConBotones(postId) {
    const messageData = {
        recipient: {
            post_id: postId // ID del post en el cual responder
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Of course, what is your budget for the gift?",
                    buttons: [
                        {
                            type: "postback",
                            title: "LESS THAN $20",
                            payload: "GIFT_BUDGET_20_PAYLOAD"
                        },
                        {
                            type: "postback",
                            title: "$20 TO $50",
                            payload: "GIFT_BUDGET_20_TO_50_PAYLOAD"
                        },
                        {
                            type: "postback",
                            title: "MORE THAN $50",
                            payload: "GIFT_BUDGET_50_PAYLOAD"
                        }
                    ]
                }
            }
        }
    };

    request({
        uri: `https://graph.facebook.com/v21.0/${process.env.PAGE_ID}/messages`,
        qs: { access_token: APP_TOKEN },
        method: 'POST',
        json: messageData
    }, function (error, response, body) {
        if (error) {
            console.error('Error al enviar mensaje con botones:', error);
        } else if (response.statusCode !== 200) {
            console.error('Error en la respuesta de la API de Facebook:', response.body);
        } else {
            console.log('Mensaje con botones enviado:', body);
        }
    });
}
