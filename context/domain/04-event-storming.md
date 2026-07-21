# Event Storming — Asynchroniczna generacja fiszek (10xCards)

> Wynik warsztatu Event Storming prowadzonego na żywej tablicy (`board.json`).
> Stan zamrożony na fazie **`hotspots`** — komendy, aktorzy, modele odczytu,
> polityki i agregaty nie zostały jeszcze zamodelowane (fazy `commands-actors`,
> `models-policies`, `aggregates` są przed nami).
>
> Ten dokument jest wkładem (input) dla kolejnych sesji agenta — np. do
> zaprojektowania architektury, API, schematu bazy danych czy planu testów.

## Zakres procesu

Dwa powiązane podprocesy:

1. **Generacja fiszek** — z tekstu źródłowego (LLM, asynchronicznie) albo
   z ręcznie wklejonej treści (bez LLM) — obie ścieżki zbiegają się w jednym
   punkcie recenzji kandydatów.
2. **Nauka (spaced repetition)** — osobny, późniejszy w czasie proces oparty
   o bibliotekę `ts-fsrs`, uruchamiany dla kart, które są `due`.

## Oś czasu (zdarzenia domenowe)

Zdarzenia w kolejności, w jakiej występują. Wcięcie = gałąź boczna (alternatywna
ścieżka / błąd), która nie jest głównym przebiegiem.

1. **Tekst źródłowy przesłany**
   - *(gałąź)* Treść fiszek wklejona ręcznie (bez LLM) — alternatywne wejście, pomija LLM
2. **Zadanie generowania zakolejkowane**
3. **Generowanie fiszek rozpoczęte**
   - *(gałąź, błąd)* Generowanie fiszek nieudane (timeout/błąd LLM)
4. **Fiszki-kandydaci wygenerowane**
   - *(gałąź)* Kandydaci z ręcznej treści przygotowani — zbiega się tutaj z LLM-owymi kandydatami
5. **Użytkownik powiadomiony o zakończeniu generowania**
6. **Kandydat zaakceptowany**
   - *(gałąź)* Kandydat odrzucony — ślepy zaułek, ten sam moment decyzji
7. **Fiszka dodana do talii**

--- *(luka czasowa — osobna sesja, inny dzień)* ---

8. **Karty do nauki (due) wybrane**
9. **Fiszka pokazana użytkownikowi**
10. **Odpowiedź użytkownika oceniona** (Again/Hard/Good/Easy)
11. **Harmonogram powtórek przeliczony (FSRS)**
    - *(pętla 9→10→11 dla każdej karty due, aż się skończą)*
12. **Nauka na dziś ukończona**

## Kluczowe decyzje domenowe (ustalone w rozmowie)

- Generacja fiszek ma **dwie ścieżki wejścia**: automatyczną (LLM) i ręczną
  (użytkownik wkleja gotową treść) — **obie przechodzą przez tę samą recenzję
  kandydatów** przed trafieniem do talii.
- **Brak limitu** liczby generowanych fiszek w jednym podejściu.
- Użytkownik **czeka synchronicznie na stronie** podczas generowania, mimo że
  przetwarzanie w tle jest asynchroniczne (kolejka).
- **"Fiszka dodana do talii"** i **"Karta due"** to zdarzenia rozdzielone w
  czasie — karta nie staje się `due` natychmiast po dodaniu, tylko później,
  zgodnie z logiką FSRS (dokładny moment: patrz hotspot niżej).
- Nieprzejrzani/niezatwierdzeni kandydaci oraz stan generowania **nie są
  nigdzie trwale zapisywane** — zamknięcie karty lub przerwanie sesji kasuje
  postęp bez śladu.

## Hotspoty (ryzyka i otwarte pytania)

| # | Hotspot | Miejsce na osi | Typ |
|---|---------|----------------|-----|
| 1 | **Timeout generacji** — LLM nie odpowiada, zadanie wisi w kolejce, koszt bez rezultatu | przy "Generowanie rozpoczęte" | awaria |
| 2 | **Błąd modelu** — halucynacja lub merytoryczny błąd wygląda poprawnie i przechodzi bez wykrycia | przy "Fiszki-kandydaci wygenerowane" | awaria (jakość) |
| 3 | **Częściowo zaakceptowana sesja** — użytkownik przerywa przegląd, reszta kandydatów przepada bez zapisu | przy "Kandydat zaakceptowany/odrzucony" | utrata danych |
| 4 | **Zamknięcie karty w trakcie generowania** — zadanie kończy się w tle, wynik ginie bez odbiorcy | przy "Zadanie zakolejkowane" | utrata danych |
| 5 | **Stan początkowy "due"** dla nowo dodanej fiszki w FSRS — niejasne | przy "Karty do nauki wybrane" | niejasność koncepcyjna |

Wspólny wzorzec hotspotów 1, 3, 4: **koszt LLM lub praca użytkownika przepada
bez żadnego śladu ani powiadomienia.** To silny kandydat na wspólne rozwiązanie
architektoniczne (np. trwały stan zadania generowania + kolejka/dead-letter +
powiadomienie), a nie osobne łatki per przypadek.

## Co dalej (niezamodelowane fazy)

- `commands-actors` — komendy i aktorzy inicjujący każde zdarzenie.
- `models-policies` — modele odczytu, polityki reaktywne ("whenever X then Y"),
  systemy zewnętrzne (np. konkretny dostawca LLM).
- `aggregates` — agregaty (np. `GenerationJob`, `FlashcardCandidate`, `Deck`,
  `Card`) i granice bounded context (generacja vs nauka).

## Źródło

Wygenerowano ze stanu `board.json` na fazie `hotspots`, sesja Event Storming
z 2026-07-21.
