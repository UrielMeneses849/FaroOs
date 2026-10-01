package app.faro.mobile.data

import app.faro.mobile.BuildConfig

object AppConfig {
  val supabaseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
  val publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY
  val isConfigured get() = supabaseUrl.startsWith("https://") && publishableKey.isNotBlank()

  fun requireConfigured() {
    check(isConfigured) {
      "Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en mobile/android/local.properties."
    }
  }
}
