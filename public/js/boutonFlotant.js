function boutonFlotant(){
    const fabMain = document.getElementById('fabMain');
    const fabOptions = document.getElementById('fabOptions');
    const plusIcon = document.getElementById('plusIcon');

    // Vérifier que tous les éléments existent avant d'ajouter les événements
    if (!fabMain) {
        console.warn('Élément fabMain introuvable, l\'événement ne sera pas attaché');
        return;
    }

    if (!fabOptions) {
        console.warn('Élément fabOptions introuvable, l\'événement ne sera pas attaché');
        return;
    }

    if (!plusIcon) {
        console.warn('Élément plusIcon introuvable, l\'événement ne sera pas attaché');
        return;
    }

    fabMain.addEventListener('click', () => {
        fabOptions.classList.toggle('show');
        // Rotation du "+" uniquement
        plusIcon.style.transform = fabOptions.classList.contains('show') ? 'rotate(45deg)' : 'rotate(0deg)';
    });
}