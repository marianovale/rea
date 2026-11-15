// Tema Diablo IV: fundo de brasa, círculo de runas e brasas subindo.
// A arte oficial do jogo é da Blizzard e não vem no repositório. Para usar um
// wallpaper ou vídeo seu, salve-o nesta pasta como fundo.mp4, fundo.gif ou
// fundo.jpg (fica fora do git) e reinstale; sem ele, o fundo abaixo é
// desenhado pelo próprio app.
registerTheme({
  id: 'diablo4',
  name: 'Diablo IV',

  hero: {
    kicker: 'Santuário',
    title: 'Diablo IV',
    tagline: 'O inferno não espera. Escolha por onde começar.'
  },

  font: {
    display: '"Cinzel", "Trajan Pro", Georgia, serif',
    ui: '"Helvetica Neue", Arial, sans-serif',
    // Carregada da internet; sem conexão, usa as alternativas acima.
    url: 'https://fonts.googleapis.com/css?family=Cinzel:400,700&display=swap'
  },

  colors: {
    background: '#090404',
    text: '#efe4d6',
    muted: 'rgba(239, 228, 214, 0.58)',
    accent: '#c3261b',
    onAccent: '#fff4ea',
    glow: 'rgba(225, 50, 20, 0.55)',
    shade: '9, 3, 3',
    card: '#1b0d0b'
  },

  // Fundo desenhado (sempre presente; a foto ou o vídeo, se houver, fica por cima).
  backdrop:
    'radial-gradient(ellipse 45% 40% at 74% 58%, rgba(190, 38, 18, 0.55) 0%, rgba(190, 38, 18, 0) 70%),' +
    'radial-gradient(ellipse 30% 22% at 80% 78%, rgba(255, 128, 40, 0.30) 0%, rgba(255, 128, 40, 0) 70%),' +
    'radial-gradient(ellipse 80% 45% at 60% 110%, rgba(120, 14, 8, 0.85) 0%, rgba(120, 14, 8, 0) 70%),' +
    'radial-gradient(ellipse 60% 50% at 20% 10%, rgba(60, 10, 8, 0.6) 0%, rgba(60, 10, 8, 0) 70%),' +
    'linear-gradient(180deg, #0b0505 0%, #170807 55%, #0a0404 100%)',

  // Círculo de runas original (não é arte do jogo), girando devagar.
  ornament: {
    type: 'runes',
    color: '#e0452c',
    opacity: 0.2
  },

  particles: {
    motion: 'rise',
    color: [255, 116, 40],
    count: 46
  },

  // Vídeos disponíveis na aba "Papel de parede" (arquivos nesta pasta).
  wallpapers: [
    { file: '1-lilith-hell-gate-1080.mp4', name: 'Portal de Lilith' },
    { file: '1-opened-hell-gate-1080.mp4', name: 'Portal aberto' },
    { file: '2-lilith-1080.mp4', name: 'Lilith II' },
    { file: '3-lilith-1080.mp4', name: 'Lilith III' },
    { file: '5-lilith-1080.mp4', name: 'Lilith V' }
  ]
});
