plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release builds are signed with the keystore named by these variables (the
// GitHub workflow fills them from repository secrets). Without them the APK
// is signed with the machine's debug key, which works but means the next
// install with a different key needs an uninstall first.
val keystorePath: String? = System.getenv("UNITV_KEYSTORE")

android {
    namespace = "io.github.marianovale.unitv"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.marianovale.unitv"
        // The UniTV V10 runs Android 10.
        minSdk = 29
        targetSdk = 35
        versionCode = 4
        versionName = "1.3"
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("UNITV_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("UNITV_KEY_ALIAS") ?: "unitv"
                keyPassword = System.getenv("UNITV_KEY_PASSWORD") ?: System.getenv("UNITV_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (keystorePath != null) "release" else "debug")
        }
    }

    // One copy of the phone page, shared with the Node server.
    sourceSets["main"].assets.srcDir("../../remote/public")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Sideloaded on one box; Play Store checks do not apply.
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("dev.mobile:dadb:2.0.0")
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit")
    // Android's org.json is a stub in local unit tests.
    testImplementation("org.json:json:20250517")
}
