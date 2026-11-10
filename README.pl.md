# Scattered Keyhole

> **English:** [README.md](README.md) - angielski oryginal tego dokumentu

[![Release](https://img.shields.io/github/v/release/mar3ksoftware/scattered-keyhole?label=APK)](https://github.com/mar3ksoftware/scattered-keyhole/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Android%20%C2%B7%20Windows%20%C2%B7%20Linux%20%C2%B7%20Web-4f46e5)](#setup)
[![Storage](https://img.shields.io/badge/messages%20on%20disk-zero-10b981)](#data--privacy)
[![E2EE](https://img.shields.io/badge/E2EE-P--256%20%C2%B7%20AES--256--GCM-a855f7)](#how-e2ee-works)
[![Release assets](https://img.shields.io/github/actions/workflow/status/mar3ksoftware/scattered-keyhole/release-assets.yml)](https://github.com/mar3ksoftware/scattered-keyhole/actions/workflows/release-assets.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

**Czat przez dziurke od klucza. Nic po sobie nie zostaje.**

Scattered Keyhole to czat z szyfrowaniem end-to-end i zerowa trwaloscia wiadomosci: wiadomosci prywatne, grupy oraz szyfrowane udostepnianie zdjec i filmow. Serwer pelni wylacznie role przekaznika - przekazuje szyfr, informacje o obecnosci i sklad grupy, nigdy nie zapisuje wiadomosci na dysku, po 24 h kasuje efemeralne media, a konta trzyma w SQLite. Caly stack: Bun, Socket.io, React, Web Crypto i Flutter.

Wiadomosci sa szyfrowane na urzadzeniu nadawcy (ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM) i deszyfrowane wylacznie na urzadzeniu odbiorcy. Serwer nigdy nie widzi tekstu jawnego.

**Private Chat** pozostaje dostepne jako [legacy release](https://github.com/mar3ksoftware/scattered-keyhole/releases/tag/v1.0.0).

Projekt sklada sie z trzech czesci: backendu na Bun (port 3000), aplikacji webowej React oraz aplikacji Flutter na Linux desktop i Androida.

## Funkcje

- **Szyfrowanie end-to-end.** ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM; serwer nigdy nie widzi tekstu jawnego.
- **Wiadomosci prywatne i grupowe.** Czlonek grupy, ktory jest offline, zachowuje czlonkostwo i po ponownym dolaczeniu wraca do grupy.
- **Administracja grupami.** Admini dodaja i usuwaja czlonkow; tworca grupy nie moze zostac usuniety ani wyrzucony.
- **Glosowanie o wyrzucenie.** Czlonkowie glosuja nad wyrzuceniem kogos; do przyjecia wystarcza zwykla wiekszosc (`floor(members / 2) + 1`) w 60 sekund.
- **Gosc i konta.** Mozna dolaczyc jako gosc albo zarejestrowac sie i zalogowac haslem oraz opcjonalnym PIN-em (4-6 cyfr).
- **Szyfrowane udostepnianie mediow.** Zdjecia i filmy sa szyfrowane na urzadzeniu; serwer trzyma nieczytelne bloby w pamieci z TTL 24 h.
- **Opcjonalny TLS/HTTPS.** Backend moze sam terminowac TLS albo pracowac na czystym `http` za reverse proxy.
- **Konfigurowalny adres serwera.** Z ekranu logowania wskazujesz dowolny host w sieci LAN lub domene.
- **Zero trwalosci czatu.** Ani localStorage, ani cookies, ani serwerowej pamieci wiadomosci.
- **Ograniczanie zapytan.** Token bucket, 10 zapytan/s na socket.
- **Interfejs responsywny.** Na desktopie panel dzielony, na urzadzeniach mobilnych widoki ulozone pod soba; ciemny motyw glass.

## Konfiguracja

### Wymagania

- [Bun](https://bun.sh) v1.1+ - backend
- [Node.js](https://nodejs.org) v20+ - frontend webowy
- [Flutter](https://docs.flutter.dev/get-started/install) (kanal stable) - aplikacja mobilna i desktopowa

### Instalacja jednym poleceniem (backend i web)

```bash
chmod +x install.sh
./install.sh
```

Skrypt instaluje zaleznosci, uruchamia backend pod http://localhost:3000 i frontend deweloperski pod http://localhost:5173. Ctrl+C zatrzymuje oba procesy. Aplikacje Flutter konfiguruje sie osobno - opis ponizej.

### Backend

```bash
cd backend
bun install
bun run src/index.ts
```

Serwer nasluchuje na porcie z `PORT` (domyslnie `3000`) i odpowiada na `GET /health`. `bun run dev` pilnuje zmian w plikach i restartuje sie przy edycji; `./run.sh` to prosty wrapper na `bun run src/index.ts`.

W katalogu `backend/` lezy gotowy plik `.env` z wartosciami z tabeli ponizej - Bun wczytuje go automatycznie przy `bun run`.

| Zmienna | Domyslna | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera |
| `CORS_ORIGINS` | `http://localhost:5173` (ustawione w `backend/.env`; bez `.env` kod wraca do `*`) | Originy dozwolone dla Socket.io i CORS `/media`, oddzielone przecinkami |
| `LOG_LEVEL` | `info` | Poziom logow Pino (`debug`, `info`, `warn`, `error`) |
| `DB_PATH` | `chat.db` | Sciezka do pliku bazy SQLite |
| `PING_INTERVAL` | `25000` | Interwal ping Socket.io (ms) |
| `PING_TIMEOUT` | `20000` | Timeout ping Socket.io (ms) |
| `TLS_CERT_FILE` | _(nie ustawione)_ | Sciezka do certyfikatu TLS (PEM). Trzeba ja ustawiac razem z `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | _(nie ustawione)_ | Sciezka do klucza prywatnego TLS (PEM). Trzeba ja ustawiac razem z `TLS_CERT_FILE` |

### Frontend webowy

```bash
cd frontend
npm install
npm run dev
```

Otworz http://localhost:5173. W trybie deweloperskim Vite proxyuje `/socket.io` i `/media` do `http://localhost:3000`, wiec nie trzeba nic dodatkowo konfigurowac.

Build produkcyjny:

```bash
cd frontend
npm run build        # sprawdzenie typow + bundel -> frontend/dist/
```

| Zmienna | Domyslna | Opis |
|---|---|---|
| `VITE_API_URL` | _(nie ustawione - ten sam origin)_ | Adres backendu, wypalany przy budowaniu (np. `VITE_API_URL=https://chat.example.com npm run build`). Jesli nie jest ustawiony, socket.io laczy sie z tym samym origin (proxy Vite w dev, reverse proxy w produkcji). |

### Aplikacja Flutter (Linux desktop i Android)

```bash
cd mobile
flutter pub get

flutter run -d linux            # build deweloperski na desktopie
flutter build apk --release     # APK na Androida -> build/app/outputs/flutter-apk/app-release.apk
flutter build linux --release   # pakiet Linux -> build/linux/
```

**Adres serwera.** Domylnie aplikacja laczy sie z `http://localhost:3000`. Na ekranie logowania rozwiw wiersz **Server**, wpisz adres backendu i naciskaj Save - na przyklad `http://192.168.1.5:3000` w sieci LAN albo `https://chat.example.com` za TLS-em. Adres zapisuje sie na urzadzeniu i zmienisz go tylko przy wylogowaniu.

**Cleartext HTTP na Androidzie.** Manifest Androida ustawia `android:usesCleartextTraffic="true"`, wiec czyste serwery `http://` w sieci LAN dzialaja od razu. W publicznym internecie uzywaj HTTPS.

### Praca w sieci LAN

1. Podlacz serwer i klientow do tej samej sieci.
2. Otworz port TCP 3000 w zaporze serwera (np. `sudo ufw allow 3000/tcp`).
3. Backend nasluchuje na wszystkich interfejsach. Przy serwerze `192.168.1.5` sprawdz `http://192.168.1.5:3000/health`.
4. Flutter: ustaw wiersz Server na ekranie logowania na `http://192.168.1.5:3000`.
5. Web dev: Vite juz nasluchuje na `0.0.0.0:5173` - otworz `http://192.168.1.5:5173` z innego komputera i dodaj ten origin do `CORS_ORIGINS` w backendzie.

### TLS / HTTPS z domena

Certyfikaty zawsze pozyskuje sie zewnetrznie (certbot, wlasna CA, `openssl`) - aplikacja nie ma w sobie automatyzacji ACME/Let's Encrypt. Z domena do wyboru sa dwie opcje:

**Opcja A - backend terminuje TLS.** Ustaw obie zmienne, a Bun bedzie serwowal `https`/`wss` bezposrednio na `PORT` (bez obu zmiennych zostaje czyste `http`, czyli domyslny tryb):

```bash
TLS_CERT_FILE=/etc/scattered-keyhole/fullchain.pem TLS_KEY_FILE=/etc/scattered-keyhole/privkey.pem bun run src/index.ts
```

Obie zmienne musza byc ustawione razem; ustawienie tylko jednej konczy sie bledem `TLS_CERT_FILE and TLS_KEY_FILE must be set together`.

**Opcja B - TLS terminuje reverse proxy.** Backend zostaje na czystym `http` za nginx (patrz przyklad produkcyjny ponizej, `listen 443 ssl`). W backendzie nic sie nie zmienia.

Klienci nie wymagaja zadnej szczegolnej konfiguracji: `socket.io-client` sam wywodzi `wss:` z `https:`, a klient mobilny akceptuje adresy serwera `https://` bez zmian. Wskaz ich na https origin:

```bash
# Build frontendu
VITE_API_URL=https://chat.example.com npm run build
```

Ustaw `CORS_ORIGINS` na https origin (np. `https://chat.example.com`). `*` tez dziala, ale na produkcji nie jest zalecane.

Szybki test kontrolny:

```bash
cd backend
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=localhost"
TLS_CERT_FILE=cert.pem TLS_KEY_FILE=key.pem bun run src/index.ts
curl -k https://localhost:3000/health
```

Po wyczyszczeniu tych zmiennych serwer nadal musi odpowiadac na `http://localhost:3000/health`.

### Wdrozenie produkcyjne

#### 1. Zbuduj frontend webowy

```bash
cd frontend
npm run build
# Wynik: frontend/dist/
```

#### 2. Skonfiguruj reverse proxy (przyklad nginx)

TLS terminuje sie w nginx; backend zostaje na czystym `http` (opcja B). Certyfikaty pozyskuje sie zewnetrznie (np. certbot).

```nginx
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Serwuj pliki statyczne frontendu
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy Socket.io do backendu
    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Proxy wysylek i pobieran mediow do backendu
    location /media/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # nginx domyslnie dopuszcza 1 MB, co dawaloby 413 na kazdym zalaczniku
        client_max_body_size 17m;
    }
}
```

Obie direktwy sa potrzebne: bez `location /media/` wysylki nie dociera do backendu, a bez `client_max_body_size 17m;` (plik 16 MiB + 16-bajtowy tag GCM + zapas) domyslny limit 1 MB w nginx odrzuca kazde wyslanie kodem 413.

Jesli to backend terminuje TLS (opcja A), zmien `proxy_pass` na `https://127.0.0.1:3000`.

#### 3. Uruchom backend

```bash
cd backend
PORT=3000 LOG_LEVEL=warn bun run src/index.ts
```

#### 4. Menedzer procesow (opcjonalnie)

```bash
# Przyklad systemd
cat > /etc/systemd/system/scattered-keyhole.service << 'EOF'
[Unit]
Description=Scattered Keyhole Backend
After=network.target

[Service]
Type=simple
User=chat
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/bun run src/index.ts
Restart=on-failure
Environment=PORT=3000
Environment=LOG_LEVEL=warn
Environment=DB_PATH=/var/lib/scattered-keyhole/accounts.db
# Opcjonalny TLS (patrz sekcja TLS / HTTPS z domena)
# Environment=TLS_CERT_FILE=/etc/scattered-keyhole/fullchain.pem
# Environment=TLS_KEY_FILE=/etc/scattered-keyhole/privkey.pem

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now scattered-keyhole
```

Juz istniejace wdrozenia musza zmienic nazwe pliku unitu i sciezki, by zgadzaly sie z nowa nazwa (`private-chat.service` -> `scattered-keyhole.service`, `/etc/private-chat` -> `/etc/scattered-keyhole`, `/var/lib/private-chat` -> `/var/lib/scattered-keyhole`).

## Architektura

```
Scattered Keyhole/
  backend/     Serwer Bun + Socket.io (port 3000)
  frontend/    React + Vite + Tailwind CSS (dev port 5173)
  mobile/      Aplikacja Flutter (Linux desktop i Android)
  install.sh   Instalacja jednym poleceniem (zaleznosci + backend i web)
```

- **Backend** - serwer Bun HTTP udostepniajacy `/health`, `/media/*` oraz silnik Socket.io na `/socket.io`. Kazdy payload przechodzi przez walidacje Zod, serwer przekazuje zdarzenia, trzyma konta i katalog gosci w SQLite, a grupy, glosowania, obecnosc i bloby mediow w pamieci.
- **Frontend webowy** - aplikacja React (SPA). Cala kryptografia dziala w przegladarce przez Web Crypto API; zalaczniki ida przez HTTP `PUT`/`GET /media/:id`.
- **Aplikacja Flutter** - ten sam kontrakt zdarzen i kryptografia co klient webowy, zbudowane na `socket_io_client` i `dart:io`.

### Moduly backendu (`backend/`)

| Modul | Opis |
|---|---|
| `src/index.ts` | Punkt wejscia Bun.serve, health check, graceful shutdown |
| `src/server.ts` | Obsluga zdarzen Socket.io (join, register, login, message, e2ee relay, grupy, czlonkostwo, vote-kick, disconnect) |
| `src/types.ts` | Typy brandowane, mapy zdarzen, typy payloadow |
| `src/config.ts` | Konfiguracja ze zmiennych srodowiskowych (port, CORS, logi, ping, TLS, sciezka DB) |
| `src/account-store.ts` | Trwalosc SQLite przez `bun:sqlite`, bcrypt przez `Bun.password` |
| `src/user-directory.ts` | Zbior zarejestrowanych kont i nazw gosci (czlonkowie grup offline) |
| `src/group-store.ts` | Grupy i czlonkostwo w pamieci |
| `src/kick-vote-store.ts` | Jedno aktywne glosowanie na wyrzucenie na grupe, TTL 60 s |
| `src/user-registry.ts` | Sledzenie aktywnych uzytkownikow w pamieci, TTL 30 s po rozlaczeniu |
| `src/rate-limiter.ts` | Token bucket - 10 zapytan/s na socket |
| `src/validators.ts` | Walidacja Zod dla wszystkich payloadow |
| `src/e2ee.ts` | Prymitywy kryptograficzne ECDH P-256 + HKDF-SHA256 + AES-GCM-256 |
| `src/e2ee-session.ts` | Zarzadzanie kluczami wspoldzielonymi dla kazdego peera |
| `src/media-store.ts` | Bloby zalacznikow w pamieci, TTL 24 h, limity, okresowe sprzatanie |
| `src/media-auth.ts` | Tokeny Bearer do mediow (jeden aktywny token na uzytkownika, TTL 24 h) |
| `src/media-http.ts` | Handler `/media/:id` (PUT/GET/OPTIONS) z CORS i ograniczaniem zapytan |
| `src/logger.ts` | Strukturalny loger Pino |

### Moduly frontendu (`frontend/`)

| Modul | Opis |
|---|---|
| `src/App.tsx` | Korzen aplikacji: wrapper ChatProvider, bramka logowania |
| `src/context/ChatContext.tsx` | React Context + useReducer na caly stan aplikacji |
| `src/lib/socket.ts` | Singleton socket.io-client (uwzglednia `VITE_API_URL`) |
| `src/lib/e2ee.ts` | Prymitywy Web Crypto API (te same co w backendzie) |
| `src/lib/e2ee-session.ts` | Zarzadzanie kluczami po stronie klienta |
| `src/components/AuthScreen.tsx` | Zakladki Login / Register / Guest |
| `src/components/ChatLayout.tsx` | Uklad z podzielonym panelem (split-pane) |
| `src/components/Sidebar.tsx` | Lista uzytkownikow, baner ephemeral, biezacy uzytkownik |
| `src/components/ChatArea.tsx` | Lista wiadomosci, pole wprowadzania i naglowek |
| `src/components/MessageBubble.tsx` | Pojedyncza wiadomosc ze statusem E2EE |
| `src/components/UserItem.tsx` | Klikalny wiersz uzytkownika |

### Moduly aplikacji mobilnej (`mobile/`)

| Modul | Opis |
|---|---|
| `lib/main.dart` | Punkt wejscia aplikacji |
| `lib/src/state/chat_controller.dart` | Stan aplikacji (ChangeNotifier), odpowiednik webowego `ChatContext` |
| `lib/src/net/socket_service.dart` | Polaczenie Socket.io (domyslnie `http://localhost:3000`) |
| `lib/src/net/server_config.dart` | Walidowany i zapisywany adres serwera z ekranu logowania |
| `lib/src/net/chat_events.dart` | Stale nazw zdarzen Socket.io (identyczne jak w backendzie) |
| `lib/src/net/media_client.dart` | Klient HTTP `PUT`/`GET /media` z tokenem Bearer |
| `lib/src/net/media_opener.dart` | Otwiera pobrany zalacznik w zewnetrznej przegladarce |
| `lib/src/crypto/e2ee.dart` | Prymitywy ECDH P-256 + HKDF-SHA256 + AES-GCM-256 |
| `lib/src/crypto/e2ee_session.dart` | Zarzadzanie kluczami wspoldzielonymi dla kazdego peera |
| `lib/src/crypto/media_crypto.dart` | Szyfrowanie pojedynczego pliku (klucz pliku + IV, SHA-256) |
| `lib/src/models/` | Modele protokolu: user, group, message, media, auth, errors |
| `lib/src/ui/` | Ekrany (logowanie, powloka czatu, lista rozmow) i widgety |

### Kontrakt zdarzen Socket.io

Pelne typy leza w `backend/src/types.ts`; klient Flutter powtarza nazwy w `lib/src/net/chat_events.dart`.

**Klient -> serwer:**

| Zdarzenie | Cel |
|---|---|
| `user:join` | Dolaczenie jako gosc z nazwa uzytkownika |
| `user:register`, `user:login` | Logowanie do konta (haslo, opcjonalny PIN) |
| `e2ee:public_key` | Wyslanie wlasnego klucza publicznego ECDH do jednego peera |
| `message:send` | Przekazanie jednej zaszyfrowanej wiadomosci prywatnej (`to`, `ciphertext`, `iv`) |
| `group:create` | Utworzenie grupy: nazwa plus listy nazw czlonkow (uzytkownicy offline tez moga sie trafic) |
| `group:member:add`, `group:member:remove` | Zmiany czlonkostwa tylko dla adminow |
| `group:kick:vote` | Glosowanie na wyrzucenie czlonka (wymagana wiekszosc, okno 60 s) |
| `group:message:send` | Wiadomosc grupowa: osobny szyfr dla kazdego czlonka, dla ktorego nadawca ma klucz wspoldzielony |

**Serwer -> klient:**

| Zdarzenie | Cel |
|---|---|
| `user:joined`, `user:left`, `active_users` | Lista obecnosci |
| `users:directory` | Wszystkie znane nazwy (konta i goscie) dzieki czemu do grupy mozna dodac osobe offline |
| `active_groups` | Zrzut grup przy dolaczeniu, potem aktywne jeszcze glosowania |
| `e2ee:public_key` | Przekazany klucz publiczny peera (klucz wyslany przez klienta jest tez odsylany do niego - to jego wlasny klucz, potrzebny do odszyfrowania odbic grupowych) |
| `private_message` | Wiadomosc prywatna wylacznie z szyfrem |
| `group:message` | Wiadomosc grupowa z szyframi dla poszczegolnych czlonkow |
| `group:created`, `group:created_error`, `group:message_delivery_failed`, `group:member:removed`, `group:kick:tally` | Cykl zycia grupy, zmiany czlonkostwa, na zywo liczace sie glosy (`active` / `passed` / `expired`) |
| `delivery_failed`, `message_rejected`, `error` | Bledy - nie ma kolejki offline, wiadomosc do uzytkownika offline od razu konczy sie niepowodzeniem |
| `register_success` / `register_error`, `login_success` / `login_error` | Wyniki logowania |
| `media:token` | Token Bearer do HTTP-owych endpointow mediow |

Po udanym join, register lub login serwer wysyla zrzut: `active_groups`, `users:directory`, aktywne glosowania, `media:token` oraz `active_users`.

## Jak dziala E2EE

1. **Generowanie kluczy:** kazdy klient przy polaczeniu generuje pare kluczy ECDH P-256.
2. **Wymiana kluczy:** po zrzucie `active_users` klient wysyla swoj klucz publiczny do kazdego aktywnego uzytkownika; gdy dolacza ktos nowy, dotychczasowi klienci wysylaja mu swoje klucze. Serwer tylko przekazuje.
3. **Wyprowadzanie kluczy:** kazda strona wyprowadza wspolny klucz AES-256-GCM przez HKDF-SHA256 (pusty salt, info `scattered-keyhole-e2ee-v1`).
4. **Szyfrowanie:** wiadomosci sa szyfrowane po stronie klienta, jeszcze przed wyslaniem.
5. **Deszyfrowanie:** wiadomosci sa deszyfrowane po stronie klienta, zaraz po odbiorze.

W grupach nadawca szyfruje ten sam tekst osobno dla kazdego czlonka, dla ktorego ma klucz wspoldzielony (wlacznie z wlasna kopia, zeby wyswietlic wlasna wiadomosc), i wysyla tablice szyfrow. Serwer rozsyla te sama tablice do wszystkich czlonkow.

Serwer widzi wylacznie szyfr i nie jest w stanie odczytac tresci wiadomosci.

```
Klient A                      Serwer                      Klient B
   |                            |                            |
   |-- e2ee:public_key -------->|                            |
   |                            |--- e2ee:public_key ------->|
   |                            |                            |
   |-- message:send(zaszyfrowane) ->|                        |
   |                            |--- private_message ------->|
   |                            |      (tylko szyfr)        |
```

## Udostepnianie mediow

Zdjecia i filmy ida jako **zaszyfrowane po stronie klienta zalaczniki**. Nadawca generuje losowy 32-bajtowy klucz pliku i 12-bajtowy IV na plik, usuwa metadane EXIF z obrazow, szyfruje plik AES-256-GCM i wysyla szyfrogram przez `PUT /media/:id`. Wiadomosc czatu wskazujaca plik to zwykla wiadomosc E2EE, ktorej odszyfrowany tresc niesie deskryptor (`fileId`, klucz, IV, SHA-256 szyfrogramu, mime, rozmiar, wymiary, oryginalna nazwa). Klucz pliku nigdy nie opuszcza tresci wiadomosci E2EE - serwer przechowuje same nieczytelne bajty. Odbiorca przed odszyfrowaniem porownuje SHA-256 z deskryptorem, wiec podmieniony plik zostaje odrzucony.

### Wydawanie tokenow

Kazde `user:join`, `user:register` i `user:login` konczy sie zdarzeniem `media:token` z tokenem Bearer do wywolan HTTP: 32 losowe bajty zapisane jako 64 male znaki hex, wazne 24 h od wydania. Jeden aktywny token na nazwe uzytkownika - ponowne uwierzytelnienie zastepuje poprzedni token, ktory przestaje dzialac natychmiast. Tokeny zyja tylko w pamieci procesu.

### Endpointy HTTP

| Metoda | Sciezka | Auth | Sukces | Bledy |
|---|---|---|---|---|
| `PUT` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `201 {"ok":true}` (powtorzony PUT z tym samym id zastepuje wpis) | `400 {"error":"invalid_id"}`, `401 {"error":"unauthorized"}`, `404 {"error":"not_found"}`, `405 {"error":"method_not_allowed"}`, `413 {"error":"too_large"}`, `429 {"error":"rate_limited"}`, `429 {"error":"quota_exceeded"}` |
| `GET` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `200`, cialo = szyfrogram jako `application/octet-stream` z `Cache-Control: no-store` | `400`, `401`, `404 {"error":"not_found"}` (brak lub wygasly) |
| `OPTIONS` | `/media/*` | preflight CORS | `204` + naglowki CORS | - |

Wysylki sa limitowane do 10 PUT/s na token. Serwer przechowuje dokladnie bajty szyfrogramu - bez parsowania, bez transformacji.

### Limity, TTL i kasowanie po awarii

- **Tylko w pamieci** - pliki nigdy nie trafiaja na dysk ani do SQLite. Restart lub awaria kasuje wszystkie zalaczniki; klienci pokazuja wtedy `Attachment expired`.
- **Limity** - 16 MiB na plik (limit w sieci to 16 MiB + 16-bajtowy tag GCM), lacznie 512 MB i 1000 plikow.
- **TTL** - 24 godziny od wysylki; wygasle bloby sa sprzatane co 30 sekund. Nie ma usuwania po pobraniu, wiec kazdy odbiorca moze pobrac ten sam plik.

### Adres jako uprawnienie

`GET /media/:id` wymaga waznego tokena, ale kazdy posiadacz tokena z `fileId` moze pobrac plik. Serwer nie zna odbiorcow - deskryptor lezy w szyfrowanej tresci E2EE - wiec `fileId` jest uprawnieniem: losowy UUID v4 wybrany przez klienta (122 bity) jest nieodgadywalny. To ten sam model capability-URL, ktorego uzywaja WhatsApp i Matrix do plikow CDN. Tokeny nie pozwalaja dotrzec do endpointu anonimowo.

### Znane i akceptowane ograniczenia

- Kontenery wideo nie sa czyszczone - EXIF nosza tylko obrazy, wiec z obrazow go usuwamy.
- Token przetrwuje jawne wylogowanie do 24 h; zyje tylko w pamieci procesu i jest zastepowany przy najblizszym logowaniu.
- Stare klienty, ktore dostaja wiadomosc media, pokazuja surowy JSON koperty jako tekst - dzialaja w trybie zdegradowanym, ale nie padaja.

## Dane i prywatnosc

Serwer przechowuje:

- **Konta** - nazwa uzytkownika, hash hasla (bcrypt), opcjonalny hash PIN (SQLite).
- **Szyfrogramy zalacznikow** - wyslane zdjecia i filmy trzymane wylacznie w pamieci procesu (16 MiB na plik, lacznie 512 MB / 1000 plikow, TTL 24 h). Nigdy na dysku; kasowane przy resecie.
- **Nazwy gosci** - nazwa goscia, ktory kiedys dolaczyl, zostaje w malej tabeli katalogowej, zeby te osobe mozna bylo dodac do grupy pozniej, takze gdy jest offline. Dla gosci nie sa przechowywane zadne wiadomosci, dane logowania ani historia obecnosci.

Serwer nigdy nie przechowuje: tresci wiadomosci (E2EE, tylko przekaz) ani stanu sesji poza rejestrem w pamieci.

Znane ograniczenia, zaakceptowane przez projekt:

- **Serwer widzi metadane.** Nazwy uzytkownikow, czlonkostwo w grupach, obecnosc i klucze publiczne e2ee sa dla serwera widoczne, bo to on jest przekaznikiem. TLS chroni je tylko przed obserwatorami sieci - nie przed operatorem serwera.
- **Brak kolejki wiadomosci offline.** Wiadomosci adresowane do uzytkownika offline nie sa buforowane; nadawca dostaje blad dostarczenia, dokladnie jak wczesniej.
- **Nieaktualna tozsamosc goscia.** Jesli nazwa goscia zostanie pozniej zarejestrowana jako konto, wiersze grup utworzone, gdy byla goscia, zachowuja stary guest userId i nie sa migrowane. Nowe lookupy rozwiazuja juz na konto.
- **Brak automatyzacji certyfikatow.** Certyfikaty TLS trzeba odnawiac zewnetrznie.

## Testowanie

### Backend

```bash
cd backend
bun test               # testy jednostkowe
bun run typecheck      # tsc --noEmit
bunx biome check src/  # lint
```

### Frontend webowy

```bash
cd frontend
npm run typecheck
npm run lint
```

### Aplikacja Flutter

```bash
cd mobile
flutter analyze
flutter test
```

### Test E2E na zywo

Najpierw uruchom backend, potem odpal zestaw testow na zywo z `RUN_LIVE_E2E=1` (bez tej zmiennej zestaw jest pomijany):

```bash
# Terminal 1 - backend
cd backend
bun run src/index.ts

# Terminal 2 - E2E na zywo
cd mobile
RUN_LIVE_E2E=1 flutter test test/e2e_live_test.dart
```

Testy steruja prawdziwymi klientami `ChatController` podlaczonymi do dzialajacego backendu i sprawdzaja dwukierunkowe wiadomosci E2EE miedzy dwoch klientami, czlonkostwo w grupie (zaproszenie osoby offline, usuniecie przez admina, przeglosowane wyrzucenie, katalog uzytkownikow) oraz pelny obieg zalacznika (wysylka -> deskryptor przez E2EE -> pobranie -> porownanie bajt po bajcie). Zmienna `SERVER_URL` zmienia adres serwera (domyslnie `http://localhost:3000`).

## Stack technologiczny

**Backend:** Bun, Socket.io v4, Zod v4, Pino, bun:sqlite, Bun.password (bcrypt)

**Web:** React 19, Vite, TypeScript 6, Tailwind CSS v4, Socket.io-client v4, Biome

**Mobile:** Flutter/Dart, socket_io_client, cryptography, pointycastle, shared_preferences, file_picker

## Ograniczenia projektu

- **Brak trwalosci czatu.** Wiadomosci istnieja tylko w pamieci podczas sesji.
- **Brak localStorage i cookies.** Stan czatu nigdy nie trafia do pamieci przegladarki.
- **Trwale sa tylko konta.** SQLite przechowuje nazwe uzytkownika, hash hasla i hash opcjonalnego PIN.
- **TypeScript na full strict.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- **Zerowa tolerancja na `any`.** Zadnych `any`, `!` ani `@ts-ignore`.
- **Ponizej 250 LOC.** Kazdy plik produkcyjny miesci sie w 250 liniach.
- **Tylko nazwane eksporty.** Zadnych `export default` gdziekolwiek.

## Licencja

Scattered Keyhole jest wolnym oprogramowaniem na licencji GNU Affero General Public License w wersji 3.0 - pelny tekst w pliku [LICENSE](LICENSE).

Copyright (C) 2026 mar3ksoftware
