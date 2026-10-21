# Intervalo – timer de treino (Android e iPhone)

App em React Native (Expo) para treinos com intervalos: preparação, trabalho, descanso,
rodadas, séries e desaquecimento. Tem bipes, voz em português, vibração, tela sempre ligada
e tenta continuar tocando com a tela bloqueada.

## Android: instalar o APK (grátis)

1. Crie um repositório no GitHub e envie esta pasta inteira (inclusive `.github`).
   Pelo terminal:
   ```
   git init && git add . && git commit -m "Intervalo"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/intervalo.git
   git push -u origin main
   ```
2. No GitHub, abra a aba **Actions**, escolha **Gerar APK Android** e veja o build terminar (uns 10 a 15 minutos).
   Se não iniciar sozinho, clique em **Run workflow**.
3. Abra a execução concluída e baixe o arquivo **intervalo-apk** (em *Artifacts*). Descompacte o ZIP.
4. Passe o `app-release.apk` para o celular, abra e permita "instalar apps desconhecidos" quando o Android pedir.

## iPhone

A Apple só permite instalar apps fora da App Store com conta de desenvolvedor.

**Opção A – testar de graça com o Expo Go (precisa de um computador ligado):**
1. Instale o app **Expo Go** no iPhone.
2. No computador, dentro desta pasta: `npm install` e depois `npx expo start`.
3. Escaneie o QR Code com a câmera do iPhone. O app abre dentro do Expo Go.
   Observação: o Expo Go não mantém o som com a tela bloqueada como o app instalado.

**Opção B – app instalado de verdade (conta Apple Developer, US$ 99 por ano):**
1. `npm install -g eas-cli` e `eas login` (conta Expo gratuita).
2. `eas build --platform ios --profile production`
3. `eas submit --platform ios` envia para o TestFlight, onde você instala no iPhone.

## Mudar o nome do app ou o identificador

Edite `app.json`: `name`, `ios.bundleIdentifier` e `android.package`.

## Rodar no computador para desenvolver

```
npm install
npx expo start
```
