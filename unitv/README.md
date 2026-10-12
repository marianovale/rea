# UniTV: controle pelo celular e diagnóstico

Ferramentas para o seu TV box Android (Uni TV), usando ADB pela rede.
Não precisa de cabo nem de instalar nada no aparelho.

- **`remote/`** — controle remoto que abre no navegador do celular: direcional,
  volume, canal, mídia, teclado para digitar na TV e atalhos para seus apps.
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

## 3. Diagnóstico de lentidão

```bash
./unitv/diagnose.sh 192.168.0.50
```

No Windows, rode pelo **Git Bash** ou WSL. O script só lê informações, não
altera nada no aparelho, e salva `unitv-diagnostico-DATA.txt`. Ele inclui
modelo, lista de apps e endereço de rede do box, mas nenhuma conta ou senha.
Mande esse arquivo para a análise.

## Testes

```bash
node --test "unitv/**/*.test.mjs"
```

Os testes usam um `adb` falso, então não precisam do aparelho.

## Próximos passos

- **Launcher novo**: o relatório mostra o launcher atual e os apps instalados,
  que definem se vale instalar um launcher pronto ou construir um próprio.
- **Engenharia reversa com o REA**: para entender um app do box, puxe o APK
  (`adb shell pm path PACOTE` e depois `adb pull CAMINHO`) e analise com
  `rea inspect-android-package app.apk`.
