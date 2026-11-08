plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val serverSigningStorePath = providers.environmentVariable("SERVER_ANDROID_KEYSTORE_PATH").orNull
val serverSigningStorePassword = providers.environmentVariable("SERVER_ANDROID_KEYSTORE_PASSWORD").orNull
val serverSigningKeyAlias = providers.environmentVariable("SERVER_ANDROID_KEY_ALIAS").orNull
val serverSigningKeyPassword = providers.environmentVariable("SERVER_ANDROID_KEY_PASSWORD").orNull
val hasPersistentServerSigning = !serverSigningStorePath.isNullOrBlank() &&
  !serverSigningStorePassword.isNullOrBlank() && !serverSigningKeyAlias.isNullOrBlank() &&
  !serverSigningKeyPassword.isNullOrBlank()
// CI runs Android instrumentation on x86_64 emulators. Keep the debug/test APK
// small when that environment variable is set; local debug builds retain the
// normal ABI set, and release APKs retain their arm64/ARMv7 phone targets.
// A Gradle -P override must win over the job-wide emulator ABI environment
// when CI builds the ARM64 physical-device package in the same workspace.
val serverDebugAbiFilters = providers.gradleProperty("SERVER_DEBUG_ABI_FILTERS")
  .orElse(providers.environmentVariable("SERVER_DEBUG_ABI_FILTERS"))
  .orNull
  ?.split(",")
  ?.map { it.trim() }
  ?.filter { it.isNotEmpty() }
  .orEmpty()

android {
  namespace = "com.server.caller"
  signingConfigs {
    if (hasPersistentServerSigning) {
      create("serverPreview") {
        storeFile = file(serverSigningStorePath!!)
        storeType = "JKS"
        storePassword = serverSigningStorePassword
        keyAlias = serverSigningKeyAlias
        keyPassword = serverSigningKeyPassword
      }
    }
  }
  compileSdk = 36
  defaultConfig {
    applicationId = "com.server.caller"
    minSdk = 26
    targetSdk = 36
    versionCode = 2
    versionName = "0.2.0"
    resourceConfigurations += listOf("en")
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    // The Android Gradle plugin resolves prebuilt AAR native libraries from
    // the defaultConfig ABI set. Apply the selected debug target here as well
    // as on the debug build type so arm64 WebRTC libraries are packaged.
    if (serverDebugAbiFilters.isNotEmpty()) {
      ndk {
        abiFilters.clear()
        abiFilters.addAll(serverDebugAbiFilters)
      }
    }
    val projectUrl = providers.gradleProperty("SERVER_SUPABASE_URL").orElse("https://hzuovekqsjtpvmbuybxs.supabase.co").get()
    val publishableKey = providers.gradleProperty("SERVER_SUPABASE_PUBLISHABLE_KEY").orElse("sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E").get()
    buildConfigField("String", "SUPABASE_URL", "\"${projectUrl}\"")
    buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"${publishableKey}\"")
    val firebaseApiKey = providers.gradleProperty("SERVER_FIREBASE_API_KEY").orElse(providers.environmentVariable("SERVER_FIREBASE_API_KEY")).orElse("").get()
    val firebaseAppId = providers.gradleProperty("SERVER_FIREBASE_APP_ID").orElse(providers.environmentVariable("SERVER_FIREBASE_APP_ID")).orElse("").get()
    val firebaseProjectId = providers.gradleProperty("SERVER_FIREBASE_PROJECT_ID").orElse(providers.environmentVariable("SERVER_FIREBASE_PROJECT_ID")).orElse("").get()
    val firebaseSenderId = providers.gradleProperty("SERVER_FIREBASE_SENDER_ID").orElse(providers.environmentVariable("SERVER_FIREBASE_SENDER_ID")).orElse("").get()
    buildConfigField("String", "FIREBASE_API_KEY", "\"${firebaseApiKey}\"")
    buildConfigField("String", "FIREBASE_APP_ID", "\"${firebaseAppId}\"")
    buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebaseProjectId}\"")
    buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebaseSenderId}\"")
  }
  buildFeatures { buildConfig = true }
  // Provide architecture-specific release APKs for direct testing and a
  // universal preview. Google Play's AAB also generates device-specific splits.
  val releaseAbiSplits = providers.gradleProperty("SERVER_ENABLE_RELEASE_ABI_SPLITS")
    .map { it.toBoolean() }.orElse(true).get()
  splits {
    abi {
      isEnable = releaseAbiSplits
      reset()
      include("arm64-v8a", "armeabi-v7a")
      isUniversalApk = true
    }
  }
  buildTypes {
    debug {
      applicationIdSuffix = ".debug"
      if (serverDebugAbiFilters.isNotEmpty()) {
        ndk {
          abiFilters.clear()
          abiFilters.addAll(serverDebugAbiFilters)
        }
      }
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // A persistent private preview key enables in-place updates across CI runners.
      // The debug signer is only a local fallback; CI never publishes that APK.
      signingConfig = if (hasPersistentServerSigning) signingConfigs.getByName("serverPreview")
        else signingConfigs.getByName("debug")
      // Release builds always target real phones, independent of the debug
      // ABI requested by the CI job (which may be x86_64 for emulators).
      ndk {
        abiFilters.clear()
        abiFilters.addAll(listOf("armeabi-v7a", "arm64-v8a"))
      }
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("com.googlecode.libphonenumber:libphonenumber:9.0.42")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-ktx:1.10.0")
  implementation("androidx.fragment:fragment-ktx:1.9.1")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
  implementation("io.github.webrtc-sdk:android:150.7871.01")
  implementation("io.github.centrifugal:centrifuge-java:0.8.0")
  implementation("com.google.firebase:firebase-messaging:24.1.2")
  androidTestImplementation("androidx.test:runner:1.6.2")
  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test:rules:1.6.1")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
  androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}


// Bundle the same web onboarding interface into the Android companion as a reliable
// fallback when the production website has not yet deployed the latest web commit.
val copyServerOnboardingAssets by tasks.registering(Copy::class) {
  from(rootProject.projectDir.resolve("../../web")) {
    include("index.html", "app.js", "styles.css", "terms.html", "privacy.html")
  }
  into(layout.projectDirectory.dir("src/main/assets/server-web"))
}
tasks.named("preBuild").configure {
  dependsOn(copyServerOnboardingAssets)
}
