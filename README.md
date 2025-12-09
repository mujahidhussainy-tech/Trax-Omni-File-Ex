# Trax Omni Mobile App

React Native mobile application for Trax Omni CRM - built with Expo.

## Features

- **Dashboard**: Real-time stats, revenue metrics, and recent leads
- **Leads Management**: Full CRUD operations with search and filters
- **Pipeline View**: Kanban-style stage management
- **Contacts**: Customer and prospect management
- **Push Notifications**: Get notified of new leads and updates
- **Quick Actions**: Call, Email, WhatsApp integration
- **Secure Auth**: JWT-based authentication with secure token storage

## Prerequisites

1. **Node.js** (v18 or higher)
2. **npm** or **yarn**
3. **Expo CLI**: `npm install -g expo-cli`
4. **EAS CLI**: `npm install -g eas-cli`
5. **Expo Account**: Sign up at https://expo.dev

## Setup

### 1. Install Dependencies

```bash
cd trax-omni-mobile
npm install
```

### 2. Configure API URL

Edit `src/services/api.js` and update the `API_BASE_URL` to your backend:

```javascript
const API_BASE_URL = 'https://your-backend-url.com/api';
```

### 3. Configure Push Notifications (Optional)

For Firebase Cloud Messaging:
1. Create a Firebase project at https://console.firebase.google.com
2. Add Android app with package name `com.uitrax.traxomni`
3. Download `google-services.json` and place in project root
4. Update `app.json` with your Expo project ID

## Running Locally

### Start Development Server

```bash
npm start
# or
expo start
```

### Run on Android Emulator

```bash
npm run android
```

### Run on Physical Device

1. Install **Expo Go** app from Play Store
2. Scan QR code from terminal

## Building for Production

### 1. Login to Expo

```bash
eas login
```

### 2. Configure EAS Build

```bash
eas build:configure
```

### 3. Build APK (for testing)

```bash
eas build -p android --profile preview
```

This generates a downloadable APK file.

### 4. Build AAB (for Play Store)

```bash
eas build -p android --profile production
```

This generates an Android App Bundle for Play Store submission.

## Play Store Submission

### Requirements

1. **Google Play Developer Account** ($25 one-time fee)
2. **App screenshots** (phone and tablet sizes)
3. **Feature graphic** (1024x500)
4. **Privacy Policy URL**

### Steps

1. Go to [Google Play Console](https://play.google.com/console)
2. Create new app "Trax Omni"
3. Fill in store listing details
4. Upload AAB from EAS Build
5. Complete content rating questionnaire
6. Set pricing (Free with in-app purchases)
7. Submit for review

## App Details

- **Package Name**: `com.uitrax.traxomni`
- **Version**: 1.0.0
- **Primary Color**: #7C3AED (Purple)
- **Accent Color**: #EC4899 (Pink)

## Project Structure

```
trax-omni-mobile/
├── App.js                 # Entry point with notification setup
├── app.json               # Expo configuration
├── eas.json               # EAS Build configuration
├── package.json           # Dependencies
├── assets/                # App icons and splash screen
│   ├── icon.png
│   ├── splash.png
│   ├── adaptive-icon.png
│   └── favicon.png
└── src/
    ├── context/
    │   └── AuthContext.js # Authentication state
    ├── navigation/
    │   ├── RootNavigator.js
    │   ├── AuthNavigator.js
    │   └── MainNavigator.js
    ├── screens/
    │   ├── LoginScreen.js
    │   ├── RegisterScreen.js
    │   ├── DashboardScreen.js
    │   ├── LeadsScreen.js
    │   ├── LeadDetailScreen.js
    │   ├── AddLeadScreen.js
    │   ├── PipelineScreen.js
    │   ├── ContactsScreen.js
    │   ├── ContactDetailScreen.js
    │   ├── AddContactScreen.js
    │   ├── SettingsScreen.js
    │   └── NotificationsScreen.js
    └── services/
        ├── api.js         # API client
        └── notifications.js # Push notification service
```

## Support

- **Email**: info@uitrax.com
- **Website**: https://traxomni.com

## License

Copyright 2024 UI Trax. All rights reserved.
