new Promise(resolve => {
  const checkState = () => {
    console.log('[Navigation Browser] Document readyState:', document.readyState);
    if (document.readyState === 'complete') {
      console.log('[Navigation Browser] Document is complete');
      resolve(true);
      return;
    }
    console.log('[Navigation Browser] Waiting for complete state...');
    window.addEventListener('load', () => {
      console.log('[Navigation Browser] Load event received');
      resolve(true);
    });
  };
  checkState();
})