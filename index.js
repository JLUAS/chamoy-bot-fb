const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql');

dotenv.config({ path: './.env' });

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuración de la base de datos MySQL
const dbConfig = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
  connectionLimit: 10,
};

const pool = mysql.createPool(dbConfig);

pool.on('connection', (connection) => {
  console.log('Nueva conexión establecida con ID:', connection.threadId);
});
pool.on('acquire', (connection) => {
  console.log('Conexión %d adquirida', connection.threadId);
});
pool.on('release', (connection) => {
  console.log('Conexión %d liberada', connection.threadId);
});
pool.on('error', (err) => {
  console.error('Error de MySQL: ', err);
});

function handleDisconnect() {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('Error al obtener conexión: ', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      connection.release();
      console.log('MySQL conectado');
    }
  });
}
handleDisconnect();

// Variables de entorno para tokens y API key
const APP_TOKEN = process.env.APP_TOKEN;
const APP_TOKEN_M = process.env.APP_TOKEN_M;
const APP_TOKEN_IG = process.env.APP_TOKEN_IG;

// Inicialización de OpenAI
const { OpenAI } = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

// Endpoint de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente.');
});

// Endpoint de verificación del webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === APP_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Token de verificación inválido.');
  }
});

/* ======================================
   FUNCIONALIDAD DE Q&A CON BÚSQUEDA SEMÁNTICA
   ====================================== */

// Nuestra "base de datos" de Q&A (formato: mensajes con role "user" y "assistant")
const baseQA = [
    {"messages": [{"role": "user", "content": "¿Cuál es el costo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio del bote?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudades tienen distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿En dónde puedo comunicarme con ustedes?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Me interesa mayoreo, cómo lo puedo hacer?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Qué es lo que venden?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿En qué presentación viene?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto me cuesta el envío a [ciudad]?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Necesita refrigeración?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿En dónde están ubicados?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se prepara?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuáles son los ingredientes del chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen opciones sin azúcar o dietéticas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional con Splenda, pero si prefieres que usemos Stevia, con gusto lo preparamos a pedido. Si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo pedir el producto sin azúcar?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Ofrecemos la opción de endulzar con Splenda o, si lo prefieres, con Stevia. Para más detalles, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen alternativas dietéticas en sus productos?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Normalmente preparamos nuestro producto con Splenda; sin embargo, si lo solicitas, podemos usar Stevia. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen versión dietética de este producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Elaboramos nuestro producto con Splenda y, a solicitud, podemos sustituirlo por Stevia. Si requieres más detalles, escríbenos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Es posible obtener una versión sin azúcar?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Preparamos nuestro producto con Splenda de forma habitual, aunque también ofrecemos la opción con Stevia a pedido. Para más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Utilizan edulcorantes dietéticos en su receta?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra receta tradicional utiliza Splenda; no obstante, si lo requieres, podemos preparar el producto con Stevia. Para consultas, escríbenos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Existen opciones sin azúcar en el menú?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Disponemos de una versión elaborada con Splenda y, si lo solicitas, también podemos prepararla con Stevia. Más información en el 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo solicitar el producto sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Elaboramos el producto con Splenda, pero si prefieres una opción con Stevia, con gusto lo preparamos. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen productos endulzados sin azúcar?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Nuestro producto se prepara habitualmente con Splenda, y a pedido, podemos utilizar Stevia. Si necesitas más información, escribe al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Es posible tener la versión dietética de su producto?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra receta se elabora con Splenda, aunque si lo solicitas, podemos hacerla con Stevia. Para mayor información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo pedir mi bebida con edulcorante alternativo?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Usualmente usamos Splenda, pero también ofrecemos la opción de utilizar Stevia según tu preferencia. Escribe al 8131056733 para más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Realizan productos sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, contamos con una opción elaborada con Splenda y, a pedido, podemos sustituirla por Stevia. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen opción sin azúcar?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Nuestra receta se realiza con Splenda; sin embargo, si lo prefieres, podemos preparar el producto con Stevia. Más información al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo encargar el producto en versión dietética?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Ofrecemos nuestro producto con Splenda de forma estándar y, a pedido, con Stevia. Para más detalles, escríbenos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen edulcorante natural en sus recetas?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Utilizamos Splenda en nuestra receta, pero si lo prefieres, podemos usar Stevia como edulcorante natural. Consulta más en el 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Se puede preparar el producto sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, preparamos el producto con Splenda y, si lo requieres, podemos hacerlo con Stevia. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen variantes del producto sin azúcar?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Disponemos de una versión con Splenda y, si lo solicitas, podemos ofrecerla con Stevia. Para detalles, escribe al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Hacen su producto con Stevia en lugar de Splenda?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra receta tradicional utiliza Splenda, pero podemos prepararlo con Stevia si lo requieres. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen alguna alternativa dietética en su preparación?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Sí, elaboramos el producto con Splenda y, a solicitud, podemos usar Stevia. Si necesitas más información, escríbenos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo obtener una versión sin azúcar de su producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Elaboramos nuestro producto con Splenda de manera estándar, pero si lo prefieres, lo preparamos con Stevia. Para mayor información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde están ubicados?"}, {"role": "assistant", "content": "Hola, soy la avispa. Estamos ubicados en Monterrey y contamos con distribuidores en toda la República para atender tus necesidades. Para más información, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la dirección de su establecimiento?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Nuestra sede principal se encuentra en Monterrey, respaldada por una red de distribuidores en todo el país. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudad se encuentran?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Nos encontramos en Monterrey y contamos con distribuidores estratégicos en toda la República. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde puedo encontrar sus productos?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra ubicación principal es Monterrey y operamos a través de distribuidores en diversas regiones de la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen sucursales fuera de Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. Aunque nuestra sede central se ubica en Monterrey, contamos con distribuidores en toda la República para tu conveniencia. Para más información, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es su ubicación?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Estamos establecidos en Monterrey y disponemos de distribuidores que cubren distintas regiones de la República. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su empresa?"}, {"role": "assistant", "content": "Buenos días, soy la avispa. Nuestra empresa tiene su base en Monterrey y opera mediante distribuidores en todo el territorio nacional. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo saber su dirección?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra sede está en Monterrey y complementamos nuestro servicio con distribuidores en toda la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Están solo en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. Aunque nuestra ubicación principal es Monterrey, contamos con distribuidores en diversas localidades de la República. Para más información, entra a https://chamoyavispa.com/#/distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Dónde puedo contactar con ustedes?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Nuestra sede se encuentra en Monterrey y tenemos presencia nacional gracias a nuestros distribuidores. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la dirección de su oficina principal?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Nuestra oficina principal está en Monterrey y extendemos nuestra cobertura a través de distribuidores en la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se localizan?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Estamos localizados en Monterrey y operamos con una red de distribuidores que cubre toda la República. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿En qué región está su empresa?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra base se encuentra en Monterrey, complementada por distribuidores en diferentes estados de la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo saber dónde se encuentran?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Nuestra sede está en Monterrey y contamos con una amplia red de distribuidores en todo el país. Para más detalles, escribe al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde está la ubicación de su negocio?"}, {"role": "assistant", "content": "Buenos días, soy la avispa. Nos encontramos en Monterrey y tenemos distribuidores que nos respaldan en toda la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es su base de operaciones?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra base de operaciones se sitúa en Monterrey, complementada por una red de distribuidores en diversas regiones de la República. Llama al 8131056733 para más información."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se ubica su centro de atención?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro centro principal está en Monterrey y extendemos nuestro servicio mediante distribuidores en toda la República. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Están ubicados en Monterrey?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Efectivamente, nuestra ubicación es Monterrey, y contamos con distribuidores a nivel nacional. Para más información, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Pueden indicarme su ubicación?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Estamos establecidos en Monterrey y disponemos de una red de distribuidores que abarca toda la República. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudad opera su empresa?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Operamos desde Monterrey, apoyados por distribuidores en distintas regiones de la República. Para más información, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde puedo recoger mi pedido?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro punto central se encuentra en Monterrey, pero también puedes coordinar la recogida a través de nuestros distribuidores en la República. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen puntos de venta fuera de Monterrey?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Aunque nuestra sede está en Monterrey, contamos con distribuidores en toda la República para facilitar tu acceso a nuestros productos. Para más información, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la ubicación de su tienda principal?"}, {"role": "assistant", "content": "Buen día, soy la avispa. Nuestra tienda principal se encuentra en Monterrey y está respaldada por una red de distribuidores en diversas regiones del país. Para más detalles, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su centro de distribución?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestro centro de distribución está en Monterrey y operamos con varios distribuidores en toda la República para optimizar la entrega. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Pueden decirme dónde están ubicados?"}, {"role": "assistant", "content": "Hola, soy la avispa. Estamos ubicados en Monterrey y trabajamos con distribuidores en todo el territorio nacional para atender tus pedidos. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde puedo localizar sus oficinas?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Nuestra oficina principal se encuentra en Monterrey, complementada por una red de distribuidores en toda la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde están sus instalaciones?"}, {"role": "assistant", "content": "Buenos días, soy la avispa. Nuestras instalaciones están ubicadas en Monterrey y extendemos nuestros servicios a través de distribuidores en la República. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo conocer la ubicación de su empresa?"}, {"role": "assistant", "content": "Saludos, soy la avispa. Nuestra sede se sitúa en Monterrey y contamos con distribuidores en distintas regiones de la República. Para más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su centro de servicio?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro centro de servicio se localiza en Monterrey y opera conjuntamente con distribuidores en toda la República. Para más detalles, llama al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudad está su base operativa?"}, {"role": "assistant", "content": "Estimado, soy la avispa. Nuestra base operativa se encuentra en Monterrey y contamos con una amplia red de distribuidores en la República para tu comodidad. Para más información, contáctanos al 8131056733."}]} ,
    {"messages": [{"role": "user", "content": "¿Tienen opciones sin azúcar o dietéticas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedo ser distribuidor de su producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto tiempo tarda en llegar el pedido?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿Hacen envíos internacionales?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen tienda física?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar su producto en línea?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Puedo pagar con tarjeta o solo aceptan efectivo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen descuentos por compras grandes?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, si deseas comprar al mayoreo, podemos ofrecerte un precio especial. Contáctanos para más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Acapulco?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Acapulco. Escríbenos y con gusto te compartimos la información del más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Ciudad de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en la Ciudad de México. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Toluca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Tenemos distribuidores en Toluca. Ponte en contacto con nosotros para indicarte el más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Guadalajara?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, contamos con distribuidores en Guadalajara. Escríbenos y con gusto te proporcionamos más información."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Puebla?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, contamos con distribuidores en Puebla. Escríbenos y te indicamos dónde puedes adquirir nuestros productos."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Tijuana?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Tenemos distribuidores en Tijuana. Ponte en contacto con nosotros y te damos más información."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Veracruz?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Veracruz. Escríbenos y te indicamos cómo adquirir nuestros productos."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Oaxaca?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, tenemos distribuidores en Oaxaca. Escríbenos para más detalles sobre dónde comprarlos."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Torreón?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Torreón. Escríbenos y te proporcionamos la información que necesitas."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. Sí, tenemos distribuidores en Monterrey. Escríbenos y con gusto te guiamos sobre dónde adquirir nuestros productos."}]},
    {"messages": [{"role": "user", "content": "¿Sirve para paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Qué venden?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Para qué sirve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Se pueden fabricar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden fabricar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la diferencia entre chamoy y chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para  paletas.Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada es un sabor más suave también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿Como se prepara?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente"}]},
    {"messages": [{"role": "user", "content": "¿Cómo se prepara el producto?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el procedimiento para preparar el producto?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente."}]},
    {"messages": [{"role": "user", "content": "¿De qué manera se prepara el producto?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la receta para preparar el producto?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se utiliza el concentrado para preparar el producto final?"}, {"role": "assistant", "content": "Ambos productos vienen en concentrado se pueden diluir hasta en 80 litros de agua y azúcar cada cubeta de 20 kg, dependiendo de la calidad que le quieras dar al producto final ya sea paleta, nieve de agua, trolebús o nieve de garrafa. Para una mejor información nos puedes contactar al 8131056733 y te explicamos más específicamente."}]},
    {"messages": [{"role": "user", "content": "¿Qué diferencia hay entre chamoy y chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para paletas. Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada, es un sabor más suave, también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿En qué se diferencia el chamoy de la chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para paletas. Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada, es un sabor más suave, también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿Qué distingue al chamoy de la chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para paletas. Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada, es un sabor más suave, también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿Me explican la diferencia entre chamoy y chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para paletas. Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada, es un sabor más suave, también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se distingue el chamoy de la chamoyada?"}, {"role": "assistant", "content": "El chamoy es una pasta espesa que viene en concentrado con sabor asidulado picosito ideal para paletas. Y la chamoyada tiene las mismas características con la diferencia que trae fruta deshidratada, es un sabor más suave, también ideal para paletas de primera calidad y nieves de agua, trolebuses y nieve de garrafa."}]},
    {"messages": [{"role": "user", "content": "¿Es posible elaborar nieves de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo utilizarlo para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Este producto permite fabricar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es apto para elaborar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden elaborar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es posible hacer paletas de leche con su producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo usar su producto para fabricar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Su producto permite hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es apto para producir paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Para qué se utilizan sus productos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el uso de sus productos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Para qué se emplean estos productos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la función de su producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Para qué se usan sus productos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros productos sirven para hacer paletas de chamoy, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Qué productos ofrecen?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Cuáles son sus productos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Qué es lo que ofrecen a la venta?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Qué tienen a la venta?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Qué ofrecen en su catálogo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos base para paleta de chamoy y base para paleta, nieve y trolebus de chamoyada."}]},
    {"messages": [{"role": "user", "content": "¿Es apto para hacer paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Se puede utilizar para paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Sirve este producto para hacer paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Es adecuado para fabricar paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Puedo usarlo para hacer paletas de nieve?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro producto solo sirve para paletas de agua."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto vale el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué costo tiene el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto debo pagar por el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto sale el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto se cobra por el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el valor del producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto cuesta adquirir el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio de compra?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto cuesta el bote?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el bote de chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto vale el bote?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el costo del bote de chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el envase?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuáles ciudades tienen distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿Dónde están sus distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿En qué localidades tienen distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿Cuáles son las ciudades donde se ubican sus distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿Dónde puedo encontrar a sus distribuidores?"}, {"role": "assistant", "content": "Hola, soy la avispa. Contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo comunicarme con la empresa?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿A través de qué medio puedo contactarlos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo ponerme en contacto con ustedes?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el número para contactarlos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo logro comunicarme con ustedes?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo realizo una compra al mayoreo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "Estoy interesado en mayoreo, ¿qué debo hacer?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo adquirir el producto al mayoreo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el proceso para comprar al por mayor?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se hace una compra al mayoreo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Puedes contactarnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Qué productos comercializan?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿Qué artículos tienen a la venta?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿Qué ofrecen para comprar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿Qué productos ofrecen a la venta?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿Qué tienen en su catálogo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Vendemos chamoy y chamoyada para paleta y nieve de agua."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se presenta el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿En qué formato se ofrece el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la presentación del chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿De qué forma se vende el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿En qué envase se encuentra el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy viene en presentación de cubeta de 20 kg."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el costo de envío a mi localidad?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto cuesta el envío a mi ciudad?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Qué costo tiene el envío a [ciudad]?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio del envío a mi área?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto debo pagar por el envío?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mándanos un mensaje a 8131056733 y te cotizamos con gusto."}]},
    {"messages": [{"role": "user", "content": "¿Requiere el producto refrigeración?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿Es necesario refrigerar el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿Debe mantenerse frío el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿Se necesita conservar el producto en frío?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿Requiere el chamoy refrigeración?"}, {"role": "assistant", "content": "Hola, soy la avispa. Mientras no lo abras, puede estar a temperatura ambiente y en la sombra por 6 meses. Ya después de abierto, si se mantiene bien cerrado y en la sombra, te puede durar hasta 60 días."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su central?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudad se encuentra su sede principal?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la ubicación de su central?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se ubica su oficina central?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿En qué lugar se encuentra su central?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en la ciudad de Monterrey y contamos con distribuidores oficiales a lo largo de la República Mexicana."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el proceso de preparación?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo se elabora el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Podrían enviarme las instrucciones de preparación?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo preparar el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Qué pasos debo seguir para preparar el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Podemos con mucho gusto mandarte un manual de preparación. Ponte en contacto con nosotros al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Qué componentes tiene el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿De qué está compuesto el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuáles son los componentes del chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Qué ingredientes se usan para hacer el chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Puedes decirme los ingredientes del chamoy?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestro chamoy está elaborado con ingredientes de alta calidad, pero si deseas más detalles sobre los ingredientes específicos, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen productos sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuentan con versiones dietéticas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen alternativas sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen productos dietéticos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Tienen alguna opción sin azúcar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente manejamos nuestra receta tradicional preparada con Splenda, pero si necesitas más información, puedes escribirnos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo convertirme en distribuidor?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿Puedo registrarme como distribuidor?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿Me puedo afiliar como distribuidor?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿Es posible ser distribuidor de su marca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿Cómo puedo ser un distribuidor autorizado?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Claro! Envíanos un mensaje con tu ubicación y datos de contacto para brindarte más información sobre cómo convertirte en distribuidor."}]},
    {"messages": [{"role": "user", "content": "¿En cuánto tiempo llega el pedido?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿Cuánto demora la entrega?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿Qué tiempo de entrega manejan?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿Cuándo recibiré mi pedido?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿A cuánto tiempo está programada la entrega?"}, {"role": "assistant", "content": "Hola, soy la avispa. El tiempo de entrega depende de tu ubicación. Envíanos un mensaje con tu ciudad y te damos una estimación."}]},
    {"messages": [{"role": "user", "content": "¿Realizan envíos fuera de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Envían a otros países?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen envíos internacionales?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Se pueden hacer envíos al extranjero?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Exportan el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. De momento manejamos envíos dentro de México y contamos con los permisos para exportar hacia Estados Unidos. Si necesitas más información, contáctanos al 8131056733."}]},
    {"messages": [{"role": "user", "content": "¿Cuentan con establecimiento físico?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Dispone de tienda física?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se ubica su empresa?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la ubicación de su sede?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se localizan sus oficinas?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su centro de operaciones?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿En qué ciudad se ubica su organización?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Dónde opera su empresa?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la dirección de su establecimiento principal?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su centro de atención?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Cuál es la dirección de su sede central?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]},
    {"messages": [{"role": "user", "content": "¿Dónde se encuentra su compañía?"}, {"role": "assistant", "content": "Nuestra sede se encuentra en Monterrey y contamos con distribuidores en Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Mexticacan. Además, realizamos envíos a Estados Unidos."}]} ,
    {"messages": [{"role": "user", "content": "¿Dónde puedo comprar el producto de forma presencial?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Tienen local de ventas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Existe una tienda física donde pueda comprar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestra central está en Monterrey y trabajamos con distribuidores en varias ciudades. Escríbenos para poder indicarte el punto de venta más cercano."}]},
    {"messages": [{"role": "user", "content": "¿Se puede adquirir el producto en línea?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Tienen opción de compra en línea?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Puedo hacer mi compra online?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Se puede comprar por internet?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Realizan ventas en línea?"}, {"role": "assistant", "content": "Hola, soy la avispa. Actualmente solo manejamos venta a través de distribuidores."}]},
    {"messages": [{"role": "user", "content": "¿Aceptan pagos con tarjeta de crédito?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo abonar con tarjeta?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿Qué métodos de pago aceptan?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿Se puede pagar con tarjeta o solo con efectivo?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿Aceptan pagos electrónicos?"}, {"role": "assistant", "content": "Hola, soy la avispa. Nuestros distribuidores manejan diferentes métodos de pago. Escríbenos tu ubicación y te damos detalles."}]},
    {"messages": [{"role": "user", "content": "¿A cuánto oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto sale?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto me sale?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto me va a costar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto vale, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué tan caro está?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto lo venden?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto cuesta, por favor?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio me dan?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Me dices el costo, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto sale el producto, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto me va a costar el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio del producto, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto cobra el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto está el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto sale el producto, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Me puedes dar el precio, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto debo pagar?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué costo tiene, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el valor, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto sale, por favor?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto andamos, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio, por favor?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto me lo venden?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el costo del producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio tiene el bote, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto me va a costar el bote?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Acapulco?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Acapulco. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Acapulco?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Acapulco. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Acapulco?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Acapulco. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Ciudad de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Ciudad de México. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Ciudad de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Ciudad de México. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Ciudad de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Ciudad de México. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Toluca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Toluca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay presencia en Toluca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Toluca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo encontrar distribuidores en Toluca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Toluca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Guadalajara?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Guadalajara. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay un distribuidor en Guadalajara?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Guadalajara. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Guadalajara?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Guadalajara. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Puebla?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Puebla. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Puebla?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Puebla. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Puebla?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Puebla. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Tijuana?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Tijuana. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Tijuana?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Tijuana. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Tijuana?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Tijuana. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Veracruz?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Veracruz. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay presencia en Veracruz?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Veracruz. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Veracruz?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Veracruz. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Oaxaca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Oaxaca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Oaxaca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Oaxaca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Oaxaca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Oaxaca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Torreón?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Torreón. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Torreón?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Torreón. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Torreón?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Torreón. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Monterrey. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Monterrey. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Monterrey. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Cancún?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Cancún no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Cancún?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Cancún no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Cancún?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Cancún no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en León?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en León no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en León?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en León no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en León?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en León no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Querétaro?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Querétaro no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Querétaro?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Querétaro no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Querétaro?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Querétaro no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Mérida?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mérida no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Mérida?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mérida no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Mérida?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mérida no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Chihuahua?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Chihuahua no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Chihuahua?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Chihuahua no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Chihuahua?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Chihuahua no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en San Luis Potosí?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en San Luis Potosí no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en San Luis Potosí?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en San Luis Potosí no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en San Luis Potosí?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en San Luis Potosí no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Culiacán?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Culiacán no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Culiacán?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Culiacán no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Culiacán?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Culiacán no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Zacatecas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Zacatecas no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Zacatecas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Zacatecas no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Zacatecas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Zacatecas no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Morelia?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Morelia no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Morelia?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Morelia no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en Morelia?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Morelia no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Mexicali?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mexicali no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Mexicali?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mexicali no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Mexicali?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mexicali no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Se pueden fabricar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es posible hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo elaborar paletas de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Este producto permite fabricar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo usarlo para hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es apto para producir paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden hacer paletas de leche con su producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Me sirve para paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve el producto para paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo elaborar paletas de leche con este concentrado?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿El producto es apto para hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para fabricar paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se puede utilizar para hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es posible producir paletas de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden fabricar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es posible hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo elaborar nieves de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Este producto permite fabricar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo usarlo para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es apto para producir nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se pueden hacer nieves de leche con su producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Me sirve para nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve el producto para nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo elaborar nieves de leche con este concentrado?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿El producto es apto para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para fabricar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Se puede utilizar para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es posible producir nieves de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto me va a costar esto, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Me podrías decir el precio, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto está cobrando el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto está el bote, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuál es el precio actual?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿A cuánto lo venden normalmente?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto me sale, por favor?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Qué precio manejan, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Me informas el costo, oiga?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuánto debo abonar por el producto?"}, {"role": "assistant", "content": "Hola, soy la avispa. Buen día, gracias por su interés. Cada distribuidor maneja su propio precio en su ciudad. ¿Podrías darme información de dónde te ubicas para poder apoyarte?"}]},
    {"messages": [{"role": "user", "content": "¿Cuentan con un distribuidor en Acapulco?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Acapulco. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Existe representante en Ciudad de México?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Ciudad de México. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Tienen punto de venta en Toluca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Toluca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo encontrar un distribuidor en Guadalajara?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Guadalajara. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Ofrecen servicio en Puebla?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Puebla. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Hay un punto de venta en Tijuana?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Tijuana. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Dispone de distribuidor en Veracruz?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Veracruz. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirirlo en Oaxaca?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Oaxaca. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Cuentan con distribuidor en Torreón?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Torreón. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Está disponible en Monterrey?"}, {"role": "assistant", "content": "Hola, soy la avispa. ¡Sí! Contamos con distribuidores en Monterrey. Escríbenos para brindarte más detalles."}]},
    {"messages": [{"role": "user", "content": "¿Este concentrado se puede usar para hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo fabricar paletas de leche con este producto?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿El concentrado sirve para paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Me permite hacer paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para la elaboración de paletas de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Este producto se puede usar para hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Puedo fabricar nieves de leche con este concentrado?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Sirve para elaborar nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Es apto para la producción de nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Me permite hacer nieves de leche?"}, {"role": "assistant", "content": "No"}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Cancún?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Cancún no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Cancún?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Cancún no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en León?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en León no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Querétaro?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Querétaro no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo adquirir el producto en Mérida?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mérida no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Chihuahua?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Chihuahua no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Existe un distribuidor en San Luis Potosí?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en San Luis Potosí no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Culiacán?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Culiacán no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Puedo comprar en Zacatecas?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Zacatecas no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Hay distribuidores en Morelia?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Morelia no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]},
    {"messages": [{"role": "user", "content": "¿Tienen distribuidores en Mexicali?"}, {"role": "assistant", "content": "Hola, soy la avispa. Lamentablemente, en Mexicali no contamos con distribuidores. Escríbenos para más información sobre otras opciones."}]}
];

// Array para almacenar las Q&A con sus embeddings precalculados
const baseQAWithEmbeddings = [];

// Función para obtener el embedding de un texto (asegúrate de que tu versión de la API sea compatible)
async function obtenerEmbedding(texto) {
    try {
        const response = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: texto,
        });
        
        // Si response.data.data existe, úsalo; de lo contrario, usa response.data
        const result = response.data.data ? response.data.data : response.data;
        
        if (result && Array.isArray(result) && result.length > 0) {
          return result[0].embedding;
        } else {
          console.error("Formato de respuesta inesperado:", result);
          throw new Error("Formato de respuesta inesperado");
        }
      } catch (error) {
        console.error("Error al obtener embedding:", error.response ? error.response.data : error.message);
        throw error;
      }
  }
  
  async function precomputarEmbeddings() {
    for (const qa of baseQA) {
      const pregunta = qa.messages.find(msg => msg.role === "user").content;
      try {
        const embedding = await obtenerEmbedding(pregunta);
        baseQAWithEmbeddings.push({ qa, embedding });
      } catch (error) {
        console.error("Error al precalcular embedding para:", pregunta, error);
      }
    }
    console.log("Embeddings de Q&A base precalculados.");
  }
  precomputarEmbeddings().catch(err => console.error(err));
  
  function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }
  
  async function buscarQASimilar(query) {
    const queryEmbedding = await obtenerEmbedding(query);
    let maxSimilarity = -1;
    let mejorQA = null;
    for (const item of baseQAWithEmbeddings) {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mejorQA = item.qa;
      }
    }
    return { mejorQA, maxSimilarity };
  }
  
  async function procesarPregunta(textoPregunta) {
    try {
      const { mejorQA, maxSimilarity } = await buscarQASimilar(textoPregunta);
      const umbral = 0.8; // Ajusta según pruebas
      if (maxSimilarity >= umbral && mejorQA) {
        return mejorQA.messages.find(m => m.role === "assistant").content;
      } else {
        return "Lo siento, no pude encontrar una coincidencia exacta. ¿Podrías reformular tu pregunta?";
      }
    } catch (error) {
      console.error("Error al procesar la pregunta:", error);
      return "Ocurrió un error al procesar tu consulta.";
    }
  }
  
  /* ======================================
     FUNCIONALIDAD PARA CONSULTAS DE UBICACIÓN
     ====================================== */
  
  const distributorsLink = "https://chamoyavispa.com/#/distribuidores";
  const phoneNumber = "8131056733";
  
  const language = require('@google-cloud/language');
  // Crea un cliente (asegúrate de tener configuradas las credenciales de Google Cloud)
  const client = new language.LanguageServiceClient();
  
  /**
   * Función para analizar el texto y extraer entidades de tipo LOCATION.
   * @param {string} texto - El mensaje a analizar.
   * @returns {Promise<Array<string>>} - Un arreglo con las ubicaciones detectadas.
   */
  async function detectarUbicaciones(texto) {
    const document = {
      content: texto,
      type: 'PLAIN_TEXT',
    };
    try {
      const [result] = await client.analyzeEntities({ document });
      // Filtra las entidades de tipo LOCATION
      const ubicaciones = result.entities
        .filter(entity => entity.type === 'LOCATION')
        .map(entity => entity.name);
      return ubicaciones;
    } catch (error) {
      console.error("Error al analizar el texto con Google NL:", error);
      return [];
    }
  }

// Tu lista de ciudades donde tienes distribuidores
const ciudadesDistribuidores = [
    "Acapulco",
    "Ciudad de México",
    "Toluca",
    "Guadalajara",
    "Puebla",
    "Tijuana",
    "Veracruz",
    "Oaxaca",
    "Torreón",
    "Monterrey"
  ];
  
  /**
   * Función que verifica si alguna ubicación detectada coincide con tu lista de distribuidores.
   * @param {string} mensaje - El mensaje recibido.
   * @returns {Promise<string|null>} - La ubicación encontrada o null si ninguna coincide.
   */
  async function verificarUbicacionDistribuidora(mensaje) {
    const ubicacionesDetectadas = await detectarUbicaciones(mensaje);
    // Recorre las ubicaciones detectadas y compara (sin distinguir mayúsculas/minúsculas)
    for (const ubicacion of ubicacionesDetectadas) {
      const ubicacionNormalizada = ubicacion.toLowerCase();
      const coincide = ciudadesDistribuidores.find(ciudad =>
        ciudad.toLowerCase() === ubicacionNormalizada
      );
      if (coincide) {
        return coincide;
      }
    }
    return null;
  }
  
  /**
   * Función para procesar el mensaje recibido y decidir la respuesta.
   * Si se detecta una ubicación que coincide con tu lista, se envía la respuesta de ubicación.
   * De lo contrario, se sigue el flujo normal (por ejemplo, procesarPregunta).
   */
  async function procesarMensajeConUbicacion(mensaje, idDestino, responderFn) {
    const ubicacionEncontrada = await verificarUbicacionDistribuidora(mensaje);
    if (ubicacionEncontrada) {
      const respuestaUbicacion = `Sí, tenemos distribuidores en ${ubicacionEncontrada}. Puedes ver más detalles en: ${distributorsLink}`;
      await responderFn(idDestino, respuestaUbicacion);
    } else {
      // Si no se detecta una ubicación distribuida, se procesa el mensaje de forma normal.
      const respuesta = await procesarPregunta(mensaje);
      await responderFn(idDestino, respuesta);
    }
  }

// Función para determinar si el mensaje es una consulta sobre distribuidores utilizando OpenAI
async function isDistributorQuery(mensaje) {
  const prompt = `Determina si el siguiente mensaje es una consulta sobre la existencia de un distribuidor en una ciudad. Responde solo con "true" o "false". Mensaje: "${mensaje}"`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      prompt: prompt,
      max_tokens: 5,
      temperature: 0
    });
    const answer = completion.choices[0].text.trim().toLowerCase();
    console.log("Is distribution query", answer)
    return answer === "true";
  } catch (error) {
    console.error("Error en isDistributorQuery:", error);
    // En caso de error, asumimos que no es una consulta de distribuidor
    return false;
  }
}

async function buscarCiudad(mensaje) {
  const prompt = `Determina si la ciudad por la cual se pregunta es parte de esta lista: Acapulco, Ciudad de México, Toluca, Guadalajara, Puebla, Tijuana, Veracruz, Oaxaca, Torreón y Monterrey. Responde solo con "true" o "false" "${mensaje}"`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      prompt: prompt,
      max_tokens: 5,
      temperature: 0
    });
    const answer = completion.choices[0].text.trim().toLowerCase();
    if(answer === "true"){
      const extraerCiudadFun = await extraerCiudad(mensaje)
      return extraerCiudadFun
    }

  } catch (error) {
    console.error("Error en isDistributorQuery:", error);
    // En caso de error, asumimos que no es una consulta de distribuidor
    return false;
  }
}
async function extraerCiudad(mensaje) {
  const prompt = `Extrae el nombre de la ciudad del siguiente mensaje. Mensaje: "${mensaje}"`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      prompt: prompt,
      max_tokens: 5,
      temperature: 0
    });
    const answer = completion.choices[0]
    return answer
  } catch (error) {
    console.error("Error en isDistributorQuery:", error);
    // En caso de error, asumimos que no es una consulta de distribuidor
    return false;
  }
}

// Función para procesar consultas de ubicación
async function procesarConsultaUbicacion(mensaje) {
  const ciudad = await buscarCiudad()
  if (ciudad) {
    return `Sí, tenemos distribuidores en ${ciudad}. Puedes ver más detalles en: ${distributorsLink}`;
  } else {
    return "Lamentablemente, no contamos con distribuidores en la ciudad que mencionas. Por favor, verifica o contáctanos para más información.";
  }
}

// Función que decide el flujo a seguir según la consulta
async function procesarMensajeModificado(mensaje, idDestino, responderFn) {
  // Primero, se clasifica el mensaje
  const esConsultaDistribuidor = await isDistributorQuery(mensaje);
  if (esConsultaDistribuidor) {
    // Si es consulta de distribuidor, procesa la ubicación
    const respuestaUbicacion = await procesarConsultaUbicacion()
    await responderFn(idDestino, respuestaUbicacion);
  } else {
    // De lo contrario, se procesa la consulta con la base Q&A (embeddings)
    const respuesta = await procesarPregunta(mensaje);
    await responderFn(idDestino, respuesta);
  }
}


  
  /* ======================================
     INTEGRACIÓN EN EL WEBHOOK (POST)
     ====================================== */
  
  app.post('/webhook', async (req, res) => {
    const data = req.body;
    // Procesar eventos de Instagram
    if (data.object === 'instagram') {
      data.entry.forEach((entry) => {
        entry.changes.forEach(async (change) => {
          if (
            change.field === 'comments' &&
            change.value.from.username !== 'chamoyavispa'
          ) {
            const commentText = change.value.text;
            const commentId = change.value.id;
            console.log(`Comentario de Instagram recibido: "${commentText}"`);
            await procesarMensajeModificado(commentText, commentId, responderComentario);
          }
        });
      });
    }
  
    // Procesar eventos de página de Facebook
    if (data.object === 'page') {
      data.entry.forEach((entry) => {
        if (entry.changes && Array.isArray(entry.changes)) {
          entry.changes.forEach(async (change) => {
            if (
              change.field === 'feed' &&
              change.value.item === 'comment' &&
              change.value.from.name !== "Chamoy Avispa" &&
              change.value.message !== undefined
            ) {
              const commentText = change.value.message;
              const commentId = change.value.comment_id;
              console.log(`Comentario en Facebook recibido: "${commentText}"`);
              await procesarMensajeModificado(commentText, commentId, responderComentario);
            }
          });
        }
  
        // Procesar mensajes directos (Messenger)
        if (entry.messaging) {
          entry.messaging.forEach(async (event) => {
            const senderId = event.sender.id;
            const message = event.message?.text;
            if (message && senderId !== process.env.PAGE_ID) {
              console.log(`Mensaje de Messenger recibido: "${message}"`);
              // Se procesa consulta de ubicación en mensajes directos de igual forma
              if (/ubicad|distribu|dónde|estado|ciudad|país|pais|en que parte/i.test(message)) {
                const respuestaUbicacion = procesarConsultaUbicacion(message);
                await enviarMensaje(senderId, respuestaUbicacion);
              } else {
                const respuesta = await procesarPregunta(message);
                await enviarMensaje(senderId, respuesta);
              }
            }
          });
        }
      });
    }
  
    res.sendStatus(200);
  });
  
  /* ======================================
     FUNCIONES PARA RESPONDER (Instagram, Facebook, Messenger)
     ====================================== */
  
  async function responderComentarioInstagram(commentId, mensaje) {
    const url = `https://graph.facebook.com/v18.0/${commentId}/replies`;
    try {
      const response = await axios.post(
        url,
        { message: mensaje },
        { params: { access_token: APP_TOKEN_IG } }
      );
      console.log('Respuesta en Instagram enviada:', response.data);
    } catch (error) {
      console.error('Error en Instagram:', error.response?.data || error.message);
    }
  }
  
  async function responderComentario(commentId, mensaje) {
    const url = `https://graph.facebook.com/v15.0/${commentId}/comments`;
    try {
      const response = await axios.post(
        url,
        { message: mensaje },
        {
          params: { access_token: APP_TOKEN_M },
          headers: { 'Content-Type': 'application/json' }
        }
      );
      console.log('Respuesta en Facebook enviada:', response.data);
    } catch (error) {
      console.error('Error al responder comentario:', error.response?.data || error.message);
    }
  }
  
  async function enviarMensaje(recipientId, mensaje) {
    const url = `https://graph.facebook.com/v15.0/me/messages`;
    try {
      const response = await axios.post(
        url,
        {
          recipient: { id: recipientId },
          message: { text: mensaje }
        },
        {
          params: { access_token: APP_TOKEN_M },
          headers: { 'Content-Type': 'application/json' }
        }
      );
      console.log('Mensaje de Messenger enviado:', response.data);
    } catch (error) {
      console.error('Error al enviar mensaje:', error.response?.data || error.message);
    }
  }
  