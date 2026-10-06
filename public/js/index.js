/**
 * @function banniereFixe
 */
function banniereFixe() {
    const menu = document.querySelector('.menu');
    const header = document.querySelector('.hearderCache');
   
    const BASE_THRESHOLD_EM = 6.25;
   
    let ticking = false;
    let scrollThreshold = calculateScrollThreshold();
 
    /**
     * @returns {number}
     */
    function calculateScrollThreshold() {
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const baseThreshold = BASE_THRESHOLD_EM * rootFontSize;
       
        const viewportHeight = window.innerHeight;
        const viewportAdjustment = Math.max(0.5, Math.min(1.5, viewportHeight / 800));
       
        return Math.round(baseThreshold * viewportAdjustment);
    }
 
    /**
     * @param {number} scrollPos
     */
    const updateClasses = (scrollPos) => {
        const isFixed = scrollPos >= scrollThreshold;
        menu.classList.toggle('fixed', isFixed);
        header.classList.toggle('headerScroll', isFixed);
        ticking = false;
    };
 
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                updateClasses(window.scrollY);
            });
            ticking = true;
        }
    }, { passive: true });
 
    window.addEventListener('resize', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                scrollThreshold = calculateScrollThreshold();
                updateClasses(window.scrollY);
            });
            ticking = true;
        }
    }, { passive: true });
}