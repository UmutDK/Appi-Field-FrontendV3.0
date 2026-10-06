function popTelechargerment(){
    const openBtn = document.getElementById('openPopup');
    const closeBtn = document.getElementById('closePopup');
    const popup = document.getElementById('popup');

    // Vérifier que tous les éléments existent avant d'ajouter les événements
    if (!openBtn) {
        console.warn('Élément openPopup introuvable, l\'événement ne sera pas attaché');
        return;
    }

    if (!closeBtn) {
        console.warn('Élément closePopup introuvable, l\'événement ne sera pas attaché');
        return;
    }

    if (!popup) {
        console.warn('Élément popup introuvable, l\'événement ne sera pas attaché');
        return;
    }

    openBtn.addEventListener('click', () => {
        popup.style.display = 'flex';
    });

    closeBtn.addEventListener('click', () => {
        popup.style.display = 'none';
    });

    // Fermer si on clique à l'extérieur du contenu
    window.addEventListener('click', (e) => {
        if (e.target === popup) {
            popup.style.display = 'none';
        }
    });
}

function pourcentage(){
    const ctx = document.getElementById('myChart');

    new Chart(ctx, {
        type: 'doughnut',
            data: {
                labels: [],
        datasets: [{
            label: 'Nom inventaire',
            data: [300, 50],
            backgroundColor: [
            '#039189',
            '#e6e6e6',
            ],
            hoverOffset: 2
        }]
        }}
    );
}


