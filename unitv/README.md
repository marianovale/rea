# UniTV: controle pelo celular e diagnóstico

Ferramentas para o seu TV box Android (Uni TV), usando ADB pela rede.
Não precisa de cabo nem de instalar nada no aparelho.

- **`remote/`** — controle remoto que abre no navegador do celular: direcional,
  volume, canal, mídia, teclado para digitar na TV e atalhos para seus apps.
- **`box/`** — o mesmo controle como app Android que roda **no próprio box**,
  então funciona com o computador desligado (seção 3).
- **`diagnose.sh`** — gera um relatório (só leitura) para descobrir a causa da
  lentidão: memória, CPU, temperatura, armazenamento, apps que iniciam sozinhos,
  travamentos recentes e launcher atual.

## 1. Preparar o aparelho (uma vez)

1. No box: **Configurações → Sobre / Informações** e clique 7 vezes em
   **Build / Versão** até aparecer "Você agora é um desenvolvedor".
2. Em **Opções do desenvolvedor**, ligue **Depuração USB** e, se existir,
   **Depuração ADB pela rede** (às vezes chamada "ADB over network" ou
   "Depuração por Wi-Fi").
3. Anote o IP do box em **Configurações → Rede** (ex.: `192.168.0.50`).

No computador, instale o `adb` (Android platform-tools):

- Windows: baixe as [platform-tools](https://developer.android.com/tools/releases/platform-tools)
  e extraia; ou `winget install Google.PlatformTools`
- macOS: `brew install android-platform-tools`
- Linux: `sudo apt install adb`

Teste: `adb connect 192.168.0.50`. Na **primeira vez a TV mostra um aviso
"Permitir depuração?"** — marque _sempre permitir_ e confirme com o controle.

> Se o box não tiver a opção de ADB pela rede: ligue-o ao computador por USB
> uma vez e rode `adb tcpip 5555`. Em Android 11+, use "Depuração por Wi-Fi"
> e `adb pair IP:PORTA` com o código que aparece na TV.

## 2. Controle pelo celular

Precisa de Node.js 22+ no computador (o mesmo usado pelo REA).

```bash
node unitv/remote/server.mjs 192.168.0.50
```

Ele mostra um link como `http://192.168.0.10:8787/#t=...`. Abra esse link no
celular (mesmo Wi-Fi) e use **Adicionar à tela inicial** para virar um app.

- **Controle**: segure as setas, volume e canal para repetir.
- **Apps**: lista os apps do box; toque na ★ para fixar nos favoritos e
  **segure um favorito para renomear**.
- **Digitar na TV**: escreva no campo e toque em enviar. Acentos são
  removidos (`ação` vira `acao`), porque o Android não aceita acentos por ADB.
- O botão **IP** troca de aparelho.

O link contém um código de acesso: só quem tem o link controla a TV. Ele fica
salvo em `unitv/remote/.token` (fora do git); apague esse arquivo para gerar
outro. Variáveis opcionais: `PORT`, `UNITV_HOST`, `UNITV_TOKEN`, `ADB_PATH`.

## 3. Controle rodando no próprio box (sem o computador)

O app **Controle UniTV** (`box/`) roda o mesmo servidor e a mesma página do
celular dentro do box. Ele usa o ADB pela rede do próprio aparelho
(`127.0.0.1:5555`): um app comum não pode apertar teclas em outros apps, mas o
ADB pode. Com isso o controle (e, depois, a Alexa) não depende do Mac ligado.

### Pré-requisito: ADB pela rede ligado de forma permanente

Use a opção **Depuração ADB pela rede** das Opções do desenvolvedor (seção 1).
Se o ADB pela rede foi ligado com `adb tcpip 5555`, ele desliga quando o box
reinicia, e o app para de funcionar até alguém rodar o comando de novo.

### Instalar

1. Baixe o APK: no GitHub, **Actions → UniTV**, abra a execução mais recente
   e baixe o artefato `unitv-box-apk` (é um zip com o `.apk` dentro). Para
   compilar você mesmo: `cd unitv/box && gradle assembleRelease`, com o
   Android SDK instalado (o APK fica em `app/build/outputs/apk/release/`).
2. Instale a partir do Mac: `adb install -r app-release.apk`.
3. No box, abra **Controle UniTV**. Na primeira vez a TV mostra **"Permitir
   depuração?"**: marque _sempre permitir_ e confirme com o controle.
4. A tela mostra "Pronto" e um QR code. Aponte a câmera do celular para ele e
   use **Adicionar à tela inicial**.

Depois disso o app inicia sozinho quando o box liga, sem precisar abri-lo.
O link do celular muda em relação ao do Mac (outro IP e outro código). O botão
**Gerar novo link** troca o código e desconecta quem tinha o link antigo.

### Assinatura do APK (recomendado, uma vez)

Para cada versão nova instalar por cima da anterior, todas precisam ser
assinadas com a mesma chave. Sem isso, o Actions usa uma chave descartável e
cada atualização exige `adb uninstall io.github.marianovale.unitv` antes; aí a
TV pede para autorizar a depuração de novo e o link do celular muda.

```bash
keytool -genkeypair -keystore unitv.keystore -alias unitv -keyalg RSA \
  -keysize 2048 -validity 10000 -dname "CN=UniTV"
base64 -i unitv.keystore | pbcopy
```

Em **Settings → Secrets and variables → Actions** do repositório, crie
`UNITV_KEYSTORE_BASE64` (cole o que foi copiado) e `UNITV_KEYSTORE_PASSWORD`
(a senha escolhida). Guarde o `unitv.keystore` fora do git.

### Como funciona

- A primeira conexão gera um par de chaves do app (é ele que aparece no aviso
  "Permitir depuração?"). A chave fica nos dados do app.
- As teclas vão pelo `monkey --port 1080`, como no servidor do Mac. Enquanto
  ele roda, qualquer app do box consegue mandar teclas por essa porta local;
  é o mesmo que já acontecia com o servidor no Mac.
- O serviço fica em primeiro plano (com uma notificação), para o Android não
  fechá-lo quando falta memória.

## 4. Diagnóstico de lentidão

```bash
./unitv/diagnose.sh 192.168.0.50
```

No Windows, rode pelo **Git Bash** ou WSL. O script só lê informações, não
altera nada no aparelho, e salva `unitv-diagnostico-DATA.txt`. Ele inclui
modelo, lista de apps e endereço de rede do box, mas nenhuma conta ou senha.
Mande esse arquivo para a análise.

## 5. O que foi feito no UniTV V10 (outubro de 2026)

Box analisado: UniTV V10, Android 10, Allwinner H313 (sun50iw9p1), 1 GB de
RAM, sistema `dev-keys` não certificado.

### `logd` travado (resolvido)

O serviço de registro do sistema (`logd`) usava **94% de um núcleo** o tempo
todo. Quase todo o tempo de CPU dele era "user" e chegavam só 20 a 30 mensagens
por segundo, então não era excesso de mensagens: o `logd` tinha entrado num
loop. Desligar o registro sozinho não resolveu. Reiniciar resolveu.

1. **Opções do desenvolvedor → Tamanhos de buffer do registrador →
   Desativado.** Isso grava `persist.log.tag=Settings` e
   `persist.logd.size=65536`, e continua valendo depois de reiniciar.
2. `adb reboot`.

Para conferir: `adb shell 'top -b -n 1 -p $(pidof logd)' | tail -1` deve
mostrar perto de 0%. Se voltar a subir, reinicie de novo.

### Tela inicial pesada (trocada)

A tela inicial de fábrica (`com.class.unitvfree`) usava 60–70% de CPU e
120 MB de RAM, mesmo fora de uso. Ela foi trocada pelo
[LTvLauncher](https://github.com/leanbitlab-org/LtvLauncher): código aberto
(GPL-3), sem Firebase ou analytics no APK, versão de 32 bits. A versão
v2026.10.03 `armeabi-v7a` tem sha256
`ec77396eb05acbf22c59b27e121f59073e1da397404d0cd6a26f4f1c5eaa8221`.

```bash
adb install ltvlauncher.apk
adb shell cmd package set-home-activity com.leanbitlab.ltvL/.MainActivity
```

Para voltar à tela de fábrica:

```bash
adb shell cmd package set-home-activity com.class.unitvfree/com.supernet.tigrelauncher.MainActivity
```

As permissões especiais do LTvLauncher (acessibilidade, notificações,
estatísticas de uso) são opcionais e não foram concedidas.

### `pcdn`: serviço de fábrica (investigado, não removível sem root)

- `/system/bin/pcdn` roda como **root**, iniciado pelo sistema no boot, num
  domínio SELinux próprio (`pandoraspear`) em modo **permissivo**. Ele roda
  `ps` a cada poucos segundos e lê os dados de todos os processos.
- É um ELF ARM de 32 bits estático, sem tabela de seções e quase sem textos
  legíveis: está empacotado ou ofuscado.
- Mantém um servidor HTTP em `127.0.0.1:19906`, acessível só de dentro do box.
- Com vídeo tocando, apareceram 0 conexões UDP e 2 a 5 conexões TCP do root.
  Não houve sinal de P2P servindo outros usuários nesses testes.

Recomendação: deixar o box numa rede de convidados e não fazer login com
contas pessoais nele.

## Testes

```bash
node --test "unitv/**/*.test.mjs"
cd unitv/box && gradle testReleaseUnitTest   # precisa do Android SDK
```

Os testes usam um `adb` falso, então não precisam do aparelho. O workflow
`UniTV` do GitHub Actions roda os dois e gera o APK.

## Próximos passos

- **Alexa**: com o app rodando no box, a integração pode morar nele em vez do
  Mac.

- **Engenharia reversa com o REA**: para entender um app do box, puxe o APK
  (`adb shell pm path PACOTE` e depois `adb pull CAMINHO`) e analise com
  `rea inspect-android-package app.apk`. Esse comando precisa do
  `jadx-headless-mcp` configurado em `REA_JADX_MCP_JAR`.
