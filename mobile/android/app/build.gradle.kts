import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.serialization")
  id("org.jetbrains.kotlin.plugin.compose")
}

val localProperties = Properties().apply {
  val file = rootProject.file("local.properties")
  if (file.exists()) file.inputStream().use(::load)
}
// Reuses the existing Web/Desktop developer configuration when it is present,
// without copying it into the Android source tree or version control.
val faroWebEnv = Properties().apply {
  listOf(rootProject.file("../../.env.local"), rootProject.file("../../.env")).firstOrNull { it.exists() }
    ?.inputStream()?.use(::load)
}
fun configValue(name: String): String = localProperties.getProperty(name)
  ?: providers.environmentVariable(name).orNull
  ?: faroWebEnv.getProperty("VITE_$name")
  ?: ""
fun String.asBuildConfigString() = "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

android {
  namespace = "app.faro.mobile"
  compileSdk = 35

  sourceSets {
    getByName("main").assets.srcDir(rootProject.file("../../src/assets"))
  }

  defaultConfig {
    applicationId = "app.faro.mobile"
    minSdk = 26
    targetSdk = 35
    versionCode = 3
    versionName = "0.3.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    buildConfigField("String", "SUPABASE_URL", configValue("SUPABASE_URL").asBuildConfigString())
    buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", configValue("SUPABASE_PUBLISHABLE_KEY").asBuildConfigString())
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  packaging {
    resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  // Keep the Compose runtime aligned with Kotlin 2.0.21 and AGP 8.7.x so lint
  // can analyze the project too (rather than merely compiling it).
  implementation(platform("androidx.compose:compose-bom:2024.12.01"))
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-compose:1.10.1")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
  implementation("androidx.navigation:navigation-compose:2.8.5")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.security:security-crypto:1.1.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
  implementation("io.ktor:ktor-client-core:3.0.3")
  implementation("io.ktor:ktor-client-okhttp:3.0.3")
  implementation("io.ktor:ktor-client-content-negotiation:3.0.3")
  implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.3")
  implementation("io.ktor:ktor-client-logging:3.0.3")
  // On-device OCR for bank receipts shared with FARO. No banking document is
  // sent to an external OCR service before the user confirms the movement.
  implementation("com.google.mlkit:text-recognition:16.0.1")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
  androidTestImplementation(platform("androidx.compose:compose-bom:2024.12.01"))
  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
  androidTestImplementation("androidx.compose.ui:ui-test-junit4")
  debugImplementation("androidx.compose.ui:ui-tooling")
  debugImplementation("androidx.compose.ui:ui-test-manifest")
}
