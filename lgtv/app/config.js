// Personalize a sua tela aqui. Depois de mudar, rode ./lgtv/install.sh de novo.
var CONFIG = {
  // Nome no canto superior esquerdo.
  name: 'Minha TV',

  // Tema inicial (pasta em lgtv/app/themes/). Na TV, a aba "Temas" troca o
  // tema na hora; essa escolha fica salva na TV e passa a valer no lugar
  // deste valor.
  theme: 'diablo4',

  // Efeitos animados dos temas (brasas, runas girando). Desligue se a TV
  // ficar lenta.
  effects: true,

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

  // Relógio no canto superior direito.
  showClock: true
};
