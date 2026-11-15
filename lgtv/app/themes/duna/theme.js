// Tema Duna: areia, sol baixo e poeira no ar.
// Os vídeos e imagens do filme e do jogo não vêm no repositório (são da
// Legendary e da Funcom). Para usar um seu, salve-o nesta pasta como
// fundo.mp4, fundo.gif ou fundo.jpg (fica fora do git) e reinstale; sem
// ele, o deserto abaixo é desenhado pelo próprio app.
registerTheme({
  id: 'duna',
  name: 'Duna',

  hero: {
    kicker: 'Arrakis',
    title: 'Duna',
    tagline: 'O deserto guarda tudo. Escolha o que assistir.'
  },

  font: {
    display: '"Syncopate", "Futura", "Century Gothic", Arial, sans-serif',
    ui: '"Helvetica Neue", Arial, sans-serif',
    url: 'https://fonts.googleapis.com/css?family=Syncopate:400,700&display=swap'
  },

  colors: {
    background: '#140c06',
    text: '#f6e6cc',
    muted: 'rgba(246, 230, 204, 0.62)',
    accent: '#d9822b',
    onAccent: '#1a0f06',
    glow: 'rgba(217, 130, 43, 0.45)',
    shade: '18, 10, 4'
  },

  // Deserto desenhado: sol baixo, céu de poeira e dunas em camadas.
  backdrop:
    'radial-gradient(circle at 76% 46%, rgba(255, 214, 150, 0.95) 0%, rgba(255, 170, 80, 0.55) 4%, rgba(255, 140, 50, 0) 16%),' +
    'radial-gradient(ellipse 70% 35% at 70% 50%, rgba(230, 130, 50, 0.45) 0%, rgba(230, 130, 50, 0) 70%),' +
    'radial-gradient(ellipse 120% 30% at 30% 100%, #3a2210 0%, #3a2210 40%, rgba(58, 34, 16, 0) 41%),' +
    'radial-gradient(ellipse 90% 26% at 85% 96%, #5a3518 0%, #5a3518 45%, rgba(90, 53, 24, 0) 46%),' +
    'linear-gradient(180deg, #2a1608 0%, #6b3a17 45%, #b8692c 62%, #4a2a12 72%, #1c1008 100%)',

  // Poeira subindo devagar.
  particles: {
    motion: 'rise',
    color: [230, 170, 110],
    count: 30
  },

  // Vídeos disponíveis na aba "Papel de parede" (arquivos nesta pasta).
  wallpapers: [
    { file: 'dune-film-2021-1080.mp4', name: 'Filme (2021)' },
    { file: 'duneawakening-artwork-1080.mp4', name: 'Awakening — arte' },
    { file: 'duneawakening-keyart-1080.mp4', name: 'Awakening — key art' },
    { file: 'duneawakening-gameawards-1080.mp4', name: 'Awakening — Game Awards' }
  ]
});
