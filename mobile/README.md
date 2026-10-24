# Research Tracker for iPhone

The iPhone app is the website itself, packaged with [Capacitor](https://capacitorjs.com)
(the same way as Crossword Hub), so it installs from the App Store and shows
up in the App Library like any other app.

| | |
|---|---|
| `copy-web.js` | Copies the site into `www/` (not committed), with the Supabase sign-in library bundled so the app loads no code from the internet. |
| `capacitor.config.json` | App ID `com.emmamally.researchtracker`, name "Research Tracker", colours. |
| `ios/` | The Xcode project (generated, but committed because it holds settings: iPhone only, version, no encryption). |
| `assets/` | Icon and launch-screen sources. `npm run assets` makes every size from them. |
| `store/` | Listing text, privacy answers and screenshots. See [store/LISTING.md](store/LISTING.md). |
| `../.github/workflows/ios.yml` | Builds the app on GitHub's Macs and uploads it to App Store Connect, so no Mac is needed. |

Inside the app the page knows it's in the app (`window.Capacitor`): links in
emails (invites, password resets) point at the website, and backups and
calendar files open the iPhone share sheet.

## Updating the app

Unlike the website, the app doesn't update itself when the site changes:
each update is a new build.

1. Change the site as usual and merge.
2. For a new App Store version, raise `MARKETING_VERSION` (1.0 → 1.1) in
   `ios/App/App.xcodeproj/project.pbxproj`. The build number goes up by itself.
3. Run the workflow (step 4 below), then submit the new build (step 5).

---

# Step by step: getting into the App Store

You already did most of this once for Crossword Hub, so your Apple Developer
account and App Store Connect API key carry over. Everything works from your
iPhone (if a page is cramped, tap **aA → Request Desktop Website**).

## 0. Before you start

1. **Account deletion:** in Supabase → **SQL Editor**, run `supabase/005_delete_account.sql`.
   Apple requires apps with sign-up to let people delete their account.
2. **Demo account for Apple's reviewer:** on the website, create an account
   such as `yourname+review@gmail.com`, and add two or three example projects,
   a task or two and a meeting.

## 1. Register the app's ID (once)

1. Open https://developer.apple.com/account/resources/identifiers/list
2. Tap **+** → **App IDs** → **App** → Continue.
3. **Description:** Research Tracker · **Bundle ID:** Explicit, `com.emmamally.researchtracker`
4. Continue → **Register**. No capabilities are needed.

## 2. Create the app in App Store Connect (once)

1. https://appstoreconnect.apple.com → **Apps → + → New App**:
   iOS · name **Research Tracker** · language English · bundle ID
   **com.emmamally.researchtracker** · SKU `researchtracker-ios` · Full Access.
2. Fill in everything from [store/LISTING.md](store/LISTING.md): subtitle,
   description, keywords, URLs, category, age rating, price, App Privacy,
   review notes with the demo account, and the screenshots.

## 3. Let GitHub upload for you (once)

Use the **same** four values you added to the crosswords repository (the API
key works for every app on your account):

https://github.com/memmamally-source/First-project/settings/secrets/actions → **New repository secret**

| Name | Value |
|---|---|
| `APPSTORE_KEY_ID` | the Key ID |
| `APPSTORE_ISSUER_ID` | the Issuer ID |
| `APPSTORE_KEY` | the whole text of the `.p8` file, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----` |
| `APPLE_TEAM_ID` | the Team ID |

Lost the `.p8` file? Make a new key: App Store Connect → **Users and Access →
Integrations → App Store Connect API → Team Keys → +** (access **Admin**),
download it, and use its Key ID.

## 4. Build and test (each release, about 25 minutes, no Mac)

1. https://github.com/memmamally-source/First-project/actions/workflows/ios.yml → **Run workflow → Run workflow**.
2. When it's green (about 10 minutes), wait 10–15 minutes for Apple to process it.
3. In App Store Connect → Research Tracker → **TestFlight**, add yourself as an
   internal tester, then install it from the **TestFlight** app.

## 5. Submit for review

1. App Store Connect → Research Tracker → the **1.0** page → **Build** → choose the uploaded build.
2. **Add for Review → Submit**. Apple usually replies within a day or two.

If Apple rejects it, send me their message.
