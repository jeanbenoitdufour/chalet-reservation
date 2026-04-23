const stripe = Stripe('pk_test_VOTRE_CLE_PUBLIABLE_ICI'); // À remplacer plus tard
let elements;
let clientSecret;

// Charger les infos du chalet
async function chargerChalet() {
    try {
        const response = await fetch('/api/chalet');
        const chalet = await response.json();
        
        document.getElementById('chaletInfo').innerHTML = `
            <h2>🏠 ${chalet.nom}</h2>
            <div class="prix">${chalet.prixParNuit}€ <span style="font-size: 18px;">/ nuit</span></div>
            <p>${chalet.description}</p>
            <div class="capacite">
                👥 Capacité maximum : ${chalet.capaciteMax} personnes
            </div>
        `;
    } catch (error) {
        console.error('Erreur chargement chalet:', error);
    }
}

// Calculer le prix
async function calculerPrix() {
    const dateDebut = document.getElementById('dateDebut').value;
    const dateFin = document.getElementById('dateFin').value;
    
    if (dateDebut && dateFin) {
        const response = await fetch('/api/chalet');
        const chalet = await response.json();
        
        const debut = new Date(dateDebut);
        const fin = new Date(dateFin);
        const nuits = Math.ceil((fin - debut) / (1000 * 60 * 60 * 24));
        
        if (nuits > 0) {
            const prixTotal = nuits * chalet.prixParNuit;
            document.getElementById('prixInfo').innerHTML = `
                📊 ${nuits} nuit(s) × ${chalet.prixParNuit}€ = <span style="font-size: 20px;">${prixTotal}€</span>
            `;
        } else if (nuits === 0) {
            document.getElementById('prixInfo').innerHTML = '⚠️ Minimum 1 nuit';
        } else {
            document.getElementById('prixInfo').innerHTML = '❌ La date de départ doit être après la date d\'arrivée';
        }
    }
}

// Vérifier disponibilité
async function verifierDisponibilite(dateDebut, dateFin) {
    try {
        const response = await fetch('/api/verifier-disponibilite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateDebut, dateFin })
        });
        
        const data = await response.json();
        return data.disponible;
    } catch (error) {
        console.error('Erreur vérification:', error);
        return false;
    }
}

// Initialiser Stripe
async function initStripe() {
    elements = stripe.elements();
    const card = elements.create('card', {
        style: {
            base: {
                fontSize: '16px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                '::placeholder': { color: '#aab7c4' }
            }
        }
    });
    card.mount('#card-element');
    
    card.on('change', ({ error }) => {
        const displayError = document.getElementById('card-errors');
        if (error) {
            displayError.textContent = error.message;
        } else {
            displayError.textContent = '';
        }
    });
}

// Gestion du formulaire
document.getElementById('reservationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    
    // Désactiver le bouton
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';
    
    // Récupérer les valeurs
    const nom = document.getElementById('nom').value.trim();
    const prenom = document.getElementById('prenom').value.trim();
    const telephone = document.getElementById('telephone').value.trim();
    const email = document.getElementById('email').value.trim();
    const dateDebut = document.getElementById('dateDebut').value;
    const dateFin = document.getElementById('dateFin').value;
    
    // Validation
    if (!nom || !prenom || !telephone || !email || !dateDebut || !dateFin) {
        alert('Veuillez remplir tous les champs');
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
        return;
    }
    
    try {
        // Vérifier disponibilité
        const disponible = await verifierDisponibilite(dateDebut, dateFin);
        if (!disponible) {
            alert('❌ Désolé, ces dates ne sont pas disponibles. Veuillez choisir d\'autres dates.');
            submitBtn.disabled = false;
            btnText.style.display = 'inline';
            btnLoader.style.display = 'none';
            return;
        }
        
        // Créer réservation et intention de paiement
        const response = await fetch('/api/creer-reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nom, prenom, telephone, email, dateDebut, dateFin
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Confirmer le paiement Stripe
        const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(data.clientSecret, {
            payment_method: {
                card: elements.getElement('card'),
                billing_details: {
                    name: `${prenom} ${nom}`,
                    email: email,
                    phone: telephone
                }
            }
        });
        
        if (stripeError) {
            throw new Error(stripeError.message);
        }
        
        // Succès !
        alert('✅ Réservation confirmée ! Vous allez recevoir un email et un SMS de confirmation dans quelques instants.');
        
        // Réinitialiser le formulaire
        document.getElementById('reservationForm').reset();
        document.getElementById('prixInfo').innerHTML = '';
        
    } catch (error) {
        console.error('Erreur:', error);
        alert('❌ Erreur: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
    }
});

// Écouter les changements de dates
document.getElementById('dateDebut').addEventListener('change', calculerPrix);
document.getElementById('dateFin').addEventListener('change', calculerPrix);

// Initialisation au chargement
window.addEventListener('load', async () => {
    await chargerChalet();
    await initStripe();
    
    // Définir date minimale (aujourd'hui + 1 jour)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minDate = tomorrow.toISOString().split('T')[0];
    document.getElementById('dateDebut').min = minDate;
    document.getElementById('dateFin').min = minDate;
});
