// Personalize a sua tela aqui. Depois de mudar, rode ./lgtv/install.sh de novo.
var CONFIG = {
  // Nome no canto superior esquerdo.
  name: 'Minha TV',

  // Tema inicial (pasta em lgtv/app/themes/). Na TV, a aba "Temas" troca o
  // tema na hora; essa escolha fica salva na TV e passa a valer no lugar
  // deste valor.
  theme: 'diablo4',

  // Efeitos animados dos temas (brasas, runas girando). Desligue se a TV
  // ficar lenta. Só aparecem quando o tema não tem vídeo nem foto de fundo.
  effects: true,

  // Home limpa (false): só o wallpaper em loop, o relógio e a fileira de
  // apps embaixo, sem o título grande do tema. true traz o título de volta.
  showHero: false,

  // Qual arquivo de cada tema fica em loop na home. O nome é o do arquivo
  // dentro da pasta do tema (lgtv/app/themes/<tema>/). Serve para guardar
  // vários vídeos na pasta e escolher um sem renomear. Se deixar em branco,
  // o tema usa o fundo.mp4 (ou fundo.jpg) da pasta.
  background: {
    diablo4: '1-lilith-hell-gate-1080.mp4',
    duna: 'dune-film-2021-1080.mp4'
    // Outras opções já convertidas (na pasta de cada tema):
    //   diablo4: '1-opened-hell-gate-1080.mp4' | '2-lilith-1080.mp4'
    //            | '3-lilith-1080.mp4' | '5-lilith-1080.mp4'
    //   duna:    'duneawakening-artwork-1080.mp4' | 'duneawakening-keyart-1080.mp4'
    //            | 'duneawakening-gameawards-1080.mp4'
  },

  // Favoritos iniciais (ids dos apps). Os que não existirem na TV são
  // ignorados. Na TV, segure OK ou aperte o botão vermelho num app para
  // fixar/soltar; essa escolha fica salva na TV e passa a valer no lugar
  // desta lista.
  favorites: [
    'com.webos.app.livetv',
    'youtube.leanback.v4',
    'netflix',
    'amazon',
    'com.disney.disneyplus-prod',
    'com.webos.app.hdmi1',
    'com.webos.app.hdmi2'
  ],

  // Apps que nunca aparecem.
  hidden: ['io.github.marianovale.lgtv'],

  // Lista usada quando a TV não deixa o app ler os apps instalados (sem
  // root, só com o Modo Desenvolvedor). Abrir apps funciona mesmo assim.
  // Para descobrir o id de um app: abra-o na TV e rode no computador
  //   ares-launch --device tv --running
  knownApps: [
    { id: 'com.webos.app.livetv', title: 'TV ao vivo' },
    { id: 'youtube.leanback.v4', title: 'YouTube' },
    { id: 'netflix', title: 'Netflix' },
    { id: 'amazon', title: 'Prime Video' },
    { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
    { id: 'spotify-beehive', title: 'Spotify' },
    { id: 'com.webos.app.browser', title: 'Navegador' },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
    { id: 'com.webos.app.hdmi2', title: 'HDMI 2' },
    { id: 'com.webos.app.hdmi3', title: 'HDMI 3' },
    { id: 'com.palm.app.settings', title: 'Configurações' }
  ],

  // Depois de quantos segundos sem usar o controle a tela fica só com o
  // wallpaper e a hora (0 desliga). Qualquer botão traz o resto de volta.
  idleSeconds: 30,

  // Relógio no canto superior direito (e na tela de descanso).
  showClock: true
};
