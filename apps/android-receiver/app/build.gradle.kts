plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.server.receiver"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.server.receiver"
    minSdk = 29
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    resourceConfigurations += listOf("en")
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    val projectUrl = providers.gradleProperty("SERVER_SUPABASE_URL")
      .orElse("https://hzuovekqsjtpvmbuybxs.supabase.co").get()
    val publishableKey = providers.gradleProperty("SERVER_SUPABASE_PUBLISHABLE_KEY")
      .orElse("sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E").get()
    buildConfigField("String", "SUPABASE_URL", "\"$projectUrl\"")
    buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"$publishableKey\"")
  }

  buildFeatures { buildConfig = true }
  buildTypes {
    debug { applicationIdSuffix = ".debug" }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName("debug")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  testImplementation("junit:junit:4.13.2")
}
