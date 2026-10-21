plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.server.caller"
  compileSdk = 35
  defaultConfig {
    applicationId = "com.server.caller"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    val projectUrl = providers.gradleProperty("SERVER_SUPABASE_URL").orElse("https://hzuovekqsjtpvmbuybxs.supabase.co").get()
    val publishableKey = providers.gradleProperty("SERVER_SUPABASE_PUBLISHABLE_KEY").orElse("sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E").get()
    buildConfigField("String", "SUPABASE_URL", "\"${projectUrl}\"")
    buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"${publishableKey}\"")
  }
  buildFeatures { buildConfig = true }
  buildTypes {
    debug { applicationIdSuffix = ".debug" }
    release { isMinifyEnabled = false }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-ktx:1.10.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
  implementation("io.github.webrtc-sdk:android:150.7871.01")
  androidTestImplementation("androidx.test:runner:1.6.2")
  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test:rules:1.6.1")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
