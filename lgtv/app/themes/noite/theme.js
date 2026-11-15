// Tema Noite: azul escuro e limpo, sem efeitos.
registerTheme({
  id: 'noite',
  name: 'Noite',

  hero: {
    kicker: 'Boa noite',
    title: 'Minha TV',
    tagline: 'Tudo o que você assiste, num lugar só.'
  },

  font: {
    display: '"Helvetica Neue", Arial, sans-serif',
    ui: '"Helvetica Neue", Arial, sans-serif'
  },

  colors: {
    background: '#07090f',
    text: '#eef2fb',
    muted: 'rgba(238, 242, 251, 0.6)',
    accent: '#4f8cff',
    onAccent: '#ffffff',
    glow: 'rgba(79, 140, 255, 0.45)',
    shade: '5, 7, 12',
    card: '#1a2133'
  },

  backdrop:
    'radial-gradient(ellipse 50% 45% at 75% 35%, rgba(60, 100, 200, 0.35) 0%, rgba(60, 100, 200, 0) 70%),' +
    'radial-gradient(ellipse at 20% 0%, #23314f 0%, #0d1220 55%, #07090f 100%)'
});
