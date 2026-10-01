package app.faro.mobile.ui

/** Small pure reducer shared by the ViewModel transitions and unit tests. */
internal object FaroStateReducer {
  fun loading(current: FaroUiState, loading: Boolean) = current.copy(loading = loading, error = if (loading) null else current.error)
  fun failed(current: FaroUiState, message: String) = current.copy(loading = false, error = message)
}
