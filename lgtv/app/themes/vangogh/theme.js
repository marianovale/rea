// Tema Van Gogh: A Noite Estrelada (1889), pintura em domínio público.
// A imagem vem da Wikimedia Commons quando a TV está online; para usar uma
// cópia local, outra pintura ou um vídeo, salve-o nesta pasta como
// fundo.mp4, fundo.gif ou fundo.jpg e reinstale (ele tem prioridade). Sem
// nenhum, o céu abaixo é desenhado pelo próprio app, com espirais e estrelas.
registerTheme({
  id: 'vangogh',
  name: 'Van Gogh',

  hero: {
    kicker: 'A Noite Estrelada · 1889',
    title: 'Van Gogh',
    tagline: 'Eu sonho minha pintura, e então pinto meu sonho.'
  },

  font: {
    display: '"Cormorant Garamond", Garamond, Georgia, serif',
    ui: '"Helvetica Neue", Arial, sans-serif',
    url: 'https://fonts.googleapis.com/css?family=Cormorant+Garamond:600,700&display=swap'
  },

  colors: {
    background: '#0a1430',
    text: '#f4edd3',
    muted: 'rgba(244, 237, 211, 0.66)',
    accent: '#f0bf2c',
    onAccent: '#14213d',
    glow: 'rgba(240, 191, 44, 0.45)',
    shade: '8, 14, 34'
  },

  // Céu desenhado: lua amarela, halos de estrelas, azuis em camadas e a
  // silhueta escura das colinas.
  backdrop:
    'radial-gradient(circle at 86% 17%, rgba(255, 226, 120, 0.95) 0%, rgba(255, 210, 80, 0.55) 3.5%, rgba(255, 200, 60, 0) 11%),' +
    'radial-gradient(circle at 58% 22%, rgba(255, 236, 160, 0.55) 0%, rgba(255, 236, 160, 0) 4%),' +
    'radial-gradient(circle at 70% 40%, rgba(255, 236, 160, 0.45) 0%, rgba(255, 236, 160, 0) 3.5%),' +
    'radial-gradient(circle at 40% 12%, rgba(255, 236, 160, 0.40) 0%, rgba(255, 236, 160, 0) 3%),' +
    'radial-gradient(ellipse 50% 22% at 55% 32%, rgba(120, 170, 220, 0.35) 0%, rgba(120, 170, 220, 0) 70%),' +
    'radial-gradient(ellipse 70% 30% at 50% 100%, rgba(6, 12, 28, 0.95) 0%, rgba(6, 12, 28, 0) 70%),' +
    'linear-gradient(180deg, #13306b 0%, #1d4b8f 38%, #193a75 60%, #0b1838 100%)',

  images: [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1920px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg'
  ],
  imagePosition: 'center 30%',

  // Espirais girando devagar, como o céu da pintura (só sem foto).
  ornament: {
    type: 'swirls',
    color: '#e9d27a',
    opacity: 0.22
  },

  particles: {
    motion: 'twinkle',
    color: [255, 214, 90],
    count: 34
  }
});
