# Jetpack Compose Patterns

## Route/Screen Split

```kotlin
// Route: ViewModel + navigation wiring — the only place hiltViewModel() appears
@Composable
internal fun TopicRoute(
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TopicViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    TopicScreen(
        uiState = uiState,
        onBackClick = onBackClick,
        onFollowClick = viewModel::followTopic,
        modifier = modifier,
    )
}

// Screen: pure UI — state in, events out. Previewable, testable, no Hilt.
@Composable
internal fun TopicScreen(
    uiState: TopicUiState,
    onBackClick: () -> Unit,
    onFollowClick: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (uiState) {
        TopicUiState.Loading -> LoadingState(modifier)
        is TopicUiState.Error -> ErrorState(uiState.message, modifier)
        is TopicUiState.Success -> TopicContent(uiState, onBackClick, onFollowClick, modifier)
    }
}
```

## State Collection and Components

- `collectAsStateWithLifecycle()` always — lifecycle-aware; plain
  `collectAsState` keeps collecting in the background.
- Components are stateless: data + lambdas in, `Modifier` last with a
  default. Hoist state to the lowest common owner.
- Lazy lists: **always set `key`** and extract item composables:

```kotlin
LazyColumn(
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
) {
    items(items = feed, key = { it.id }) { item ->
        NewsResourceCard(item, onClick = { onItemClick(item.id) })
    }
}
```

## Performance Notes

(Standard Compose guidance — sources cover patterns; these are the
recomposition rules of thumb.) Pass stable/immutable types into
composables (data classes of vals, persistent lists); compute derived
values with `remember(input) { ... }` or `derivedStateOf` for
high-frequency sources; defer state reads to the deepest composable that
needs them; lambdas referencing method refs (`viewModel::onAction`) stay
stable across recompositions.

## Type-Safe Navigation (Navigation 2.8+)

```kotlin
@Serializable
data class TopicRoute(val id: String)              // in feature's api module

fun NavController.navigateToTopic(topicId: String) = navigate(TopicRoute(topicId))

fun NavGraphBuilder.topicScreen(onBackClick: () -> Unit) {
    composable<TopicRoute> {
        TopicRoute(onBackClick = onBackClick)
    }
}

// ViewModel reads typed args:
private val topicId: String = savedStateHandle.toRoute<TopicRoute>().id
```

App-level `NavHost` wires feature `NavGraphBuilder` extensions — features
never reference each other's screens directly, only navigation APIs.

## Theming — Material 3

```kotlin
@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    MaterialTheme(colorScheme = colorScheme, typography = AppTypography, content = content)
}
```

Design system lives in `core:designsystem` (theme, icons object, base
components); reusable app components in `core:ui`. Composables consume
`MaterialTheme.colorScheme.*` — never raw colour literals.

## Previews

```kotlin
@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
annotation class ThemePreviews

@ThemePreviews
@Composable
private fun TopicScreenPreview(
    @PreviewParameter(TopicPreviewParameterProvider::class) uiState: TopicUiState,
) {
    AppTheme { TopicScreen(uiState = uiState, onBackClick = {}, onFollowClick = {}) }
}
```

Previews work because Screens are ViewModel-free; `PreviewParameterProvider`
cycles Loading/Error/Success. Keep preview fixture data in the file or a
shared preview-data object.

## Adaptive Layouts

`WindowSizeClass` drives structural decisions — nav rail vs bottom bar,
list-detail vs single pane:

```kotlin
val showNavRail = windowSizeClass.widthSizeClass != WindowWidthSizeClass.Compact
```

Test compact (phone), medium (foldable/small tablet), expanded (tablet)
at least via previews (`@Preview(device = Devices.TABLET)`).
