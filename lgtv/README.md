# Minha TV: tela inicial própria para TV LG (webOS com root)

Uma tela inicial feita por você para a TV LG: favoritos, todos os apps,
relógio, cores e fundo do seu jeito. Ela é um **app separado**: a tela inicial
da LG continua instalada e intocada, e você pode remover a Minha TV a qualquer
momento.

- **`app/`** — a tela (HTML/CSS/JS). Para personalizar, comece por
  [`app/config.js`](app/config.js).
- **`service/`** — serviço que roda **como root** na TV e lista/abre os apps
  com permissão total (um app comum não pode listar todos os apps).
- **`install.sh`** — empacota, instala pela rede (SSH) e dá root ao serviço.
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

## 3. Usar

| Controle | O que faz |
| --- | --- |
| Setas | andar pelos apps |
| OK | abrir o app |
| Segurar OK, ou botão **vermelho** | fixar/soltar dos favoritos |
| Botão **verde** | recarregar a lista de apps |
| Voltar | volta para o primeiro favorito (a tela não fecha) |
| Ponteiro do Magic Remote | apontar e clicar também funciona |

O selo no topo mostra **root** quando o serviço está com root, ou **sem
root** quando falta rodar o `install.sh`.

## 4. Personalizar

Edite [`app/config.js`](app/config.js): nome, cor de destaque, fundo (cor,
degradê ou foto), favoritos iniciais e apps escondidos. O visual está em
[`app/style.css`](app/style.css) e o comportamento em
[`app/app.js`](app/app.js). Depois, `./lgtv/install.sh IP-DA-TV` de novo.

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
