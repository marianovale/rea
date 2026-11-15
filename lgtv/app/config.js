// Personalize a sua tela aqui. Depois de mudar, rode ./lgtv/install.sh de novo.
var CONFIG = {
  // Nome no canto superior esquerdo.
  name: 'Minha TV',

  // Cor de destaque (foco, botões).
  accent: '#4f8cff',

  // Fundo: qualquer valor CSS de "background". Para usar uma foto, coloque o
  // arquivo em lgtv/app/ (ex.: fundo.jpg) e use "url(fundo.jpg) center / cover".
  background: 'radial-gradient(ellipse at 20% 0%, #23314f 0%, #0d1220 55%, #07090f 100%)',

  // Favoritos iniciais (ids dos apps). Os que não existirem na TV são
  // ignorados. Na TV, segure OK ou aperte o botão vermelho para fixar/soltar;
  // essa escolha fica salva na TV e passa a valer no lugar desta lista.
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
