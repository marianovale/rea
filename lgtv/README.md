# Minha TV: tela inicial própria para TV LG (webOS com root)

Uma tela inicial feita por você para a TV LG, minimalista e com **temas**
que você troca pelo controle: Diablo IV (o inicial), Duna, Van Gogh e Noite. Ela é
um **app separado**: a tela inicial da LG continua instalada e intocada, e
você pode remover a Minha TV a qualquer momento.

- **`app/`** — a tela (HTML/CSS/JS). Para personalizar, comece por
  [`app/config.js`](app/config.js); os temas ficam em `app/themes/`.
- **`service/`** — serviço que roda **como root** na TV e lista/abre os apps
  com permissão total (um app comum não pode listar todos os apps).
- **`install.sh`** — empacota, instala pela rede (SSH) e dá root ao serviço.
- **`install-dev.sh`** — instala sem root, pelo Modo Desenvolvedor da LG
  (seção 2.1).
- **`tv/autostart.sh`** — opcional: abre a Minha TV quando a TV liga.
- **`pull-home.sh`** — copia a tela inicial da LG da TV para o computador, só
  lendo, para engenharia reversa (seção 5).

## 1. Preparar a TV (uma vez)

1. Faça o root com o método da sua versão de firmware, seguindo o
   [guia do webOS Homebrew](https://www.webosbrew.org/rooting/). Ao final, a
   TV tem o app **Homebrew Channel**.
2. Abra o **Homebrew Channel → Settings** e confira que **Root status** está
   ok e que o **SSH Server** está ligado.
3. Anote o IP da TV em **Configurações → Rede**.
4. No computador, teste: `ssh root@IP-DA-TV`. Se a senha nunca foi trocada,
   troque-a (`passwd`) ou use uma chave SSH: com o SSH ligado, qualquer um na
   sua rede que saiba a senha padrão entra como root na TV.

Também precisa de Node.js 22+ no computador (o mesmo usado pelo REA).

## 2. Instalar

```bash
./lgtv/install.sh IP-DA-TV
```

O script gera o pacote (`lgtv/dist/*.ipk`), envia, instala, dá root ao
serviço e abre a Minha TV. Rode o mesmo comando para atualizar depois de
mudar algo.

Para a Minha TV abrir sozinha quando a TV liga:

```bash
./lgtv/install.sh IP-DA-TV --autostart
```

Para remover tudo (o app e o início automático):

```bash
./lgtv/install.sh IP-DA-TV --uninstall
```

Sem computador por perto, o `.ipk` também sai no GitHub em **Actions → LG TV**
(artefato `minha-tv-ipk`) e pode ser instalado pelo
[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop). Nesse
caso o serviço só ganha root depois de um `install.sh` ou de reiniciar a TV
com o início automático instalado; até lá a tela mostra **sem root** no topo.

## 2.1 Sem root: Modo Desenvolvedor da LG

Dá para instalar sem root, com a ferramenta oficial da LG
([webOS TV CLI](https://webostv.developer.lge.com/develop/tools/cli-introduction)).
Diferenças em relação ao root:

- A TV pode não deixar o app ler a lista de apps instalados. Nesse caso a
  Minha TV usa a lista `knownApps` do [`app/config.js`](app/config.js)
  (YouTube, Netflix, HDMI...), que você pode editar. Abrir apps funciona.
- O Modo Desenvolvedor expira: abra o app **Developer Mode** na TV e use
  **Extend** a cada poucos dias. Se ele expirar, a TV apaga os apps de
  desenvolvedor e é preciso instalar de novo.
- Não abre sozinha quando a TV liga (`--autostart` precisa de root).

**Uma vez**, com o app **Developer Mode** ligado na TV (**Dev Mode Status**
e **Key Server** ligados):

```bash
npm install -g @webos-tools/cli
```

```bash
ares-setup-device --add tv -i "host=IP-DA-TV" -i "port=9922" -i "username=prisoner"
```

```bash
ares-novacom --device tv --getkey
```

O último comando pede a **passphrase** que aparece no app Developer Mode da
TV (seis letras e números).

**Para instalar ou atualizar:**

```bash
./lgtv/install-dev.sh
```

Para descobrir o id de um app e pô-lo no `knownApps`: abra o app na TV e
rode `ares-launch --device tv --running`.

## 3. Usar

A tela tem o tema em destaque, o botão **Continuar** (abre o último app usado,
ou o primeiro favorito) e uma fileira com quatro abas: **Favoritos**, **Todos
os apps**, **Entradas** (HDMI, TV ao vivo) e **Temas**.

| Controle | O que faz |
| --- | --- |
| Setas | andar; nas abas, trocar a fileira |
| OK | abrir o app, ou aplicar o tema na aba **Temas** |
| Segurar OK, ou botão **vermelho** | fixar/soltar o app dos favoritos |
| Botão **verde** | recarregar a lista de apps |
| Voltar | volta para o topo (a tela não fecha) |
| Ponteiro do Magic Remote | apontar e clicar também funciona |

O aviso **sem root** aparece no topo quando o serviço está sem root; aí falta
rodar o `install.sh`.

## 4. Temas e personalização

O tema escolhido na aba **Temas** fica salvo na TV. O tema inicial, o nome,
os favoritos iniciais e os apps escondidos ficam em
[`app/config.js`](app/config.js). Depois de mudar qualquer arquivo,
`./lgtv/install.sh IP-DA-TV` de novo.

### Home limpa (só o wallpaper)

Por padrão a home fica **limpa**: só o wallpaper em loop, o relógio e a
fileira de apps embaixo, sem o título grande do tema. Para trazer o título
de volta, use `showHero: true` no [`app/config.js`](app/config.js).

### Imagem ou vídeo de fundo

Cada tema tem um fundo desenhado pelo próprio app e aceita uma imagem ou um
vídeo por cima. Salve o arquivo **no computador**, antes de instalar, na pasta
do tema, com o nome `fundo` e uma destas extensões:

| Tema | Pasta |
| --- | --- |
| Diablo IV | `lgtv/app/themes/diablo4/` |
| Duna | `lgtv/app/themes/duna/` |
| Van Gogh | `lgtv/app/themes/vangogh/` |
| Noite | `lgtv/app/themes/noite/` |

| Arquivo | Recomendação |
| --- | --- |
| `fundo.mp4` | vídeo H.264, 1920×1080, 30 fps, **sem faixa de áudio**, laço curto (10–30 s), até uns 30 MB |
| `fundo.webm` | vídeo VP9, mesmas medidas (só TVs mais novas tocam VP9) |
| `fundo.gif` | funciona, mas GIF é pesado e com poucas cores: prefira MP4 |
| `fundo.jpg` / `fundo.png` | imagem 1920×1080, até uns 2 MB |

Dá para ter **um vídeo e uma imagem** na mesma pasta: a imagem aparece na
hora e vira a miniatura do tema na aba **Temas**, e o vídeo entra por cima
assim que carrega. Entre vídeos vale o mp4 antes do webm; entre imagens, gif,
jpg e depois png. A escolha é sua e **não é aleatória**: cada tema toca sempre
o mesmo arquivo.

**Trocar o vídeo pela TV (aba Papel de parede).** Guarde vários vídeos na
pasta do tema e liste-os em `wallpapers` no `theme.js` do tema (os temas
Diablo IV e Duna já vêm com os seus). Aí, na TV, a aba **Papel de parede**
mostra as opções do tema atual e você escolhe com o controle; a escolha fica
salva na TV. "Desenhado (sem vídeo)" usa o fundo animado do app.

**Escolher no computador (opcional).** Guarde todos na pasta do tema
e escolha um no `background` do [`app/config.js`](app/config.js):

```js
background: {
  diablo4: '1-lilith-hell-gate-diablo-4-4k-animated-wallpaper.mp4',
  duna: 'dune-film-2021-4k-animated-wallpaper.mp4'
}
```

Só o arquivo escolhido precisa estar na pasta; os outros só ocupam espaço no
pacote. Sem `background`, o tema usa o `fundo.mp4`/`fundo.jpg`.

**TVs antigas e vídeos 4K.** Modelos mais simples (como o UM7520, de 32 bits)
podem não conseguir tocar vídeo 4K: nesse caso a tela cai no fundo desenhado
(com brasas/estrelas animadas), que parece "aleatório". Converta o vídeo para
1080p com o ffmpeg (no Mac, `brew install ffmpeg`):

```bash
ffmpeg -i entrada.mp4 -vf scale=1920:-2 -an -c:v libx264 -crf 22 -preset slow fundo.mp4
``` O vídeo toca **sempre mudo** e em laço, mesmo que o arquivo tenha som.
Mesmo assim, tire a faixa de áudio: a TV pode reservar o decodificador de
áudio só por ela existir. Se o vídeo tiver som, o `install.sh` avisa e mostra
o comando:

```bash
ffmpeg -i fundo.mp4 -c copy -an sem-som.mp4 && mv sem-som.mp4 fundo.mp4
```

Quando você abre outro app, o vídeo é descarregado (não só pausado), para não
ocupar o decodificador de vídeo da TV que o outro app vai usar; ele volta
quando a Minha TV aparece de novo.

O `install.sh` coloca o arquivo dentro do app. Com imagem ou vídeo, o
ornamento desenhado (runas, espirais) some, porque o arquivo já tem o próprio
desenho; o texto continua legível por causa do escurecimento à esquerda e
embaixo.

Esses arquivos **ficam fora do git** de propósito (`.gitignore`): este
repositório é público, e um wallpaper ou vídeo de jogo, por exemplo, é arte
da Blizzard, que não pode ser redistribuída. Por isso o `.ipk` do GitHub
Actions vem sem eles; para ter os seus, instale pelo `install.sh`.

O tema **Van Gogh** já mostra *A Noite Estrelada* (1889, domínio público),
carregada da Wikimedia Commons quando a TV está online. Um `fundo.*` seu tem
prioridade sobre ela.

### Criar um tema

1. Copie uma pasta de `app/themes/` (por exemplo, `noite`) com outro nome.
2. No `theme.js` dela, troque `id` (igual ao nome da pasta), nome, textos,
   cores, fonte e fundo. Opcionais: `ornament` (`runes` ou `swirls`) e
   `particles` (`rise` para brasas, `twinkle` para estrelas).
3. Acrescente a linha do tema no fim de `app/index.html`, junto das outras
   `themes/.../theme.js`.

Os testes (`node --test "lgtv/**/*.test.mjs"`) avisam se faltar algo no tema
ou a linha no `index.html`.

Se a TV ficar lenta com as animações, use `effects: false` no `config.js`.

Para ver a tela no computador antes de instalar, abra `lgtv/app/index.html`
no Chrome com a janela em 1920×1080. Fora da TV não há lista de apps, então
ela mostra a mensagem de erro no lugar dos apps.

## 5. Engenharia reversa da tela da LG

```bash
./lgtv/pull-home.sh IP-DA-TV
```

Copia para `lgtv/re/DATA/`, **sem alterar nada na TV**:

- o app de tela inicial da LG (`com.webos.app.home` ou, em versões antigas,
  `com.webos.app.launcher`), que é um app web em JavaScript;
- as permissões dele no barramento do sistema (`luna-service2`) e a
  configuração do gerenciador de telas, que decide o que o botão **Home** abre;
- versão do firmware e a lista de apps como o sistema a vê.

Esses arquivos são da LG: ficam fora do git (`lgtv/re/` está no
`.gitignore`). Com eles dá para ver quais chamadas internas a tela da LG usa
(por exemplo, apps recentes e entradas HDMI ativas) e como o botão Home é
encaminhado, para trazer isso para a Minha TV sem mexer na tela original.

## Como funciona

- O app fala com o sistema pelo barramento `luna://` do webOS. Primeiro ele
  chama o próprio serviço (`io.github.marianovale.lgtv.service`), que roda como
  root; se o serviço não responder, tenta o sistema direto.
- O root vem do `elevate-service` do Homebrew Channel, que o `install.sh` roda
  depois de instalar e o `autostart.sh` repete a cada boot.
- O início automático é um script em `/var/lib/webosbrew/init.d/minha-tv`, que
  o Homebrew Channel executa no boot. Ele espera a interface da TV subir e
  abre a Minha TV.
- O pacote `.ipk` é montado por [`build.mjs`](build.mjs) sem dependências
  (nem o SDK da LG), com o mesmo formato do `ares-package`. Os ícones são
  gerados pelo próprio script.

## Limites desta versão

- **O botão Home do controle ainda abre a tela da LG.** Trocar isso sem mexer
  no app da LG é o próximo passo; a engenharia reversa da seção 5 mostra
  onde o sistema decide isso.
- Com o **Início rápido+** (Quick Start+) ligado, desligar pelo controle não
  reinicia a TV, então o início automático só vale quando ela reinicia de
  verdade (falta de energia, atualização ou reinício pelo menu).
- O código da tela e do serviço é ES5 de propósito, para rodar desde o webOS 3
  (navegador e Node.js antigos).
- As fontes dos temas (Cinzel, Cormorant Garamond) vêm do Google Fonts: sem
  internet, a TV usa uma fonte parecida já instalada.
