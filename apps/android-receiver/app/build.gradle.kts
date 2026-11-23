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
    buildConfigField("String", "SUPABASE_URL", "\"https://hzuovekqsjtpvmbuybxs.supabase.co\"")
    buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E\"")
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
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.work:work-runtime-ktx:2.10.0")
}
