const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Connexion MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connecté à MongoDB Atlas'))
.catch(err => console.error('❌ Erreur MongoDB:', err));

// MODÈLES
const reservationSchema = new mongoose.Schema({
  nom: { type: String, required: true, trim: true },
  prenom: { type: String, required: true, trim: true },
  telephone: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  dateDebut: { type: Date, required: true },
  dateFin: { type: Date, required: true },
  nombreNuits: { type: Number, required: true },
  prixTotal: { type: Number, required: true },
  statut: { 
    type: String, 
    enum: ['en_attente', 'payee', 'confirmee', 'annulee'],
    default: 'en_attente'
  },
  stripePaymentIntentId: { type: String, sparse: true },
  dateReservation: { type: Date, default: Date.now },
  smsEnvoye: { type: Boolean, default: false },
  emailEnvoye: { type: Boolean, default: false }
});

const chaletSchema = new mongoose.Schema({
  nom: { type: String, required: true, default: 'Chalet Montagne' },
  prixParNuit: { type: Number, required: true, default: 150 },
  description: { type: String, default: 'Chalet confortable en pleine montagne avec vue imprenable' },
  capaciteMax: { type: Number, default: 6 },
  adresse: { type: String, default: 'Station de ski, 74260 Les Gets, France' }
});

const Reservation = mongoose.model('Reservation', reservationSchema);
const Chalet = mongoose.model('Chalet', chaletSchema);

// UTILITAIRES EMAIL & SMS
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const envoyerEmailConfirmation = async (reservation, chalet) => {
  const dateDebut = new Date(reservation.dateDebut).toLocaleDateString('fr-FR');
  const dateFin = new Date(reservation.dateFin).toLocaleDateString('fr-FR');
  
  const mailOptions = {
    from: `"Chalet Réservation" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: '✅ Confirmation de votre réservation de chalet',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">🏔️ Confirmation de réservation</h1>
        <p>Bonjour ${reservation.prenom} ${reservation.nom},</p>
        <p>Votre réservation pour le <strong>${chalet.nom}</strong> a été confirmée.</p>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>📅 Détails de votre séjour :</h3>
          <p><strong>Dates :</strong> Du ${dateDebut} au ${dateFin}</p>
          <p><strong>Nombre de nuits :</strong> ${reservation.nombreNuits}</p>
          <p><strong>Prix total :</strong> ${reservation.prixTotal} €</p>
        </div>
        
        <div style="background-color: #d4edda; padding: 15px; border-radius: 5px;">
          <p><strong>🏠 Informations pratiques :</strong></p>
          <p>Arrivée : à partir de 16h00</p>
          <p>Départ : avant 10h00</p>
          <p>Ménage inclus dans le prix</p>
          <p>Draps et serviettes fournis</p>
        </div>
        
        <p style="margin-top: 20px;">📞 Pour toute question, contactez-nous au 06 12 34 56 78</p>
        <p>✨ À bientôt au chalet !</p>
      </div>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${reservation.email}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    return false;
  }
};

const twilio = require('twilio');
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const envoyerSMSConfirmation = async (reservation, chalet) => {
  const dateDebut = new Date(reservation.dateDebut).toLocaleDateString('fr-FR');
  const dateFin = new Date(reservation.dateFin).toLocaleDateString('fr-FR');
  
  const message = `🏔️ ${chalet.nom} : Reservation confirmee du ${dateDebut} au ${dateFin}. ${reservation.nombreNuits} nuits - ${reservation.prixTotal}€. Merci !`;
  
  try {
    await client.messages.create({
      body: message,
      to: reservation.telephone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    console.log(`📱 SMS envoyé à ${reservation.telephone}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi SMS:', error);
    return false;
  }
};

// FONCTION VÉRIFICATION DISPONIBILITÉ
async function verifierDisponibilite(dateDebut, dateFin) {
  const reservationsExistantes = await Reservation.find({
    statut: { $in: ['payee', 'confirmee'] },
    $or: [
      { dateDebut: { $lt: dateFin, $gte: dateDebut } },
      { dateFin: { $gt: dateDebut, $lte: dateFin } },
      { dateDebut: { $lte: dateDebut }, dateFin: { $gte: dateFin } }
    ]
  });
  
  return reservationsExistantes.length === 0;
}

// ROUTES API

// 1. Récupérer les infos du chalet
app.get('/api/chalet', async (req, res) => {
  try {
    let chalet = await Chalet.findOne();
    if (!chalet) {
      chalet = await Chalet.create({
        nom: 'Chalet des Alpes',
        prixParNuit: 150,
        capaciteMax: 6,
        description: 'Chalet confortable en pleine montagne avec vue imprenable'
      });
    }
    res.json(chalet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Vérifier disponibilité des dates
app.post('/api/verifier-disponibilite', async (req, res) => {
  try {
    const { dateDebut, dateFin } = req.body;
    const disponible = await verifierDisponibilite(new Date(dateDebut), new Date(dateFin));
    res.json({ disponible });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Créer une réservation et l'intention de paiement
app.post('/api/creer-reservation', async (req, res) => {
  try {
    const { nom, prenom, telephone, email, dateDebut, dateFin } = req.body;
    
    // Validation basique
    if (!nom || !prenom || !telephone || !email || !dateDebut || !dateFin) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    // Vérifier disponibilité
    const disponible = await verifierDisponibilite(new Date(dateDebut), new Date(dateFin));
    if (!disponible) {
      return res.status(400).json({ error: 'Ces dates ne sont pas disponibles' });
    }
    
    // Récupérer le chalet
    const chalet = await Chalet.findOne();
    if (!chalet) {
      return res.status(404).json({ error: 'Chalet non trouvé' });
    }
    
    // Calculer le prix
    const dateDebutObj = new Date(dateDebut);
    const dateFinObj = new Date(dateFin);
    const differenceMs = dateFinObj - dateDebutObj;
    const nombreNuits = Math.ceil(differenceMs / (1000 * 60 * 60 * 24));
    
    if (nombreNuits <= 0) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }
    
    const prixTotal = nombreNuits * chalet.prixParNuit;
    
    // Créer l'intention de paiement Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(prixTotal * 100), // Stripe utilise les centimes
      currency: 'eur',
      metadata: {
        nom,
        prenom,
        email,
        telephone,
        dateDebut: dateDebutObj.toISOString(),
        dateFin: dateFinObj.toISOString()
      }
    });
    
    // Créer la réservation en attente
    const reservation = new Reservation({
      nom,
      prenom,
      telephone,
      email,
      dateDebut: dateDebutObj,
      dateFin: dateFinObj,
      nombreNuits,
      prixTotal,
      stripePaymentIntentId: paymentIntent.id,
      statut: 'en_attente'
    });
    
    await reservation.save();
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      reservationId: reservation._id,
      prixTotal
    });
    
  } catch (error) {
    console.error('❌ Erreur création réservation:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Webhook Stripe (confirmation après paiement)
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`⚠️ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log(`✅ Paiement réussi pour l'intention: ${paymentIntent.id}`);
    
    // Mettre à jour la réservation
    const reservation = await Reservation.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntent.id },
      { statut: 'payee' },
      { new: true }
    );
    
    if (reservation) {
      const chalet = await Chalet.findOne();
      
      // Envoyer les confirmations
      const emailEnvoye = await envoyerEmailConfirmation(reservation, chalet);
      const smsEnvoye = await envoyerSMSConfirmation(reservation, chalet);
      
      await Reservation.findByIdAndUpdate(reservation._id, {
        emailEnvoye,
        smsEnvoye,
        statut: 'confirmee'
      });
      
      console.log(`✅ Réservation ${reservation._id} confirmée`);
    }
  }
  
  res.json({ received: true });
});

// 5. Récupérer les réservations existantes (pour le calendrier)
app.get('/api/reservations', async (req, res) => {
  try {
    const reservations = await Reservation.find({
      statut: { $in: ['payee', 'confirmee'] }
    }).select('dateDebut dateFin');
    
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Route pour la page admin (optionnel)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
// Route pour la page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📱 Interface disponible sur http://localhost:${PORT}`);
});
