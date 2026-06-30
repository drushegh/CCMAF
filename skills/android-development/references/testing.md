# Testing

NowInAndroid's approach: **test doubles, not mocking libraries**. Fakes
implement the real interfaces with test hooks — less brittle, exercises
more production code than Mockito/MockK interaction stubs.

| Type | Location | Runs on | Use for |
|---|---|---|---|
| Unit | `src/test/` | JVM | ViewModels, repositories, use cases |
| Instrumented/UI | `src/androidTest/` | device/emulator | Compose UI, DAO, integration |
| Screenshot | `src/test/` (Roborazzi) | JVM | visual regression |

## Test Doubles (in `core:testing`)

```kotlin
class TestTopicsRepository : TopicsRepository {

    private val topicsFlow = MutableSharedFlow<List<Topic>>(replay = 1)

    fun sendTopics(topics: List<Topic>) {          // test hook
        topicsFlow.tryEmit(topics)
    }

    override fun getTopics(): Flow<List<Topic>> = topicsFlow

    override fun getTopic(id: String): Flow<Topic> =
        topicsFlow.map { topics -> topics.first { it.id == id } }

    override suspend fun syncWith(synchronizer: Synchronizer): Boolean = true
}
```

Same pattern for network data sources (settable responses) and
preferences (backing `MutableStateFlow`). Shared fixture data lives in a
`TestData` object alongside them.

## ViewModel Tests

```kotlin
class TopicViewModelTest {

    @get:Rule
    val dispatcherRule = TestDispatcherRule()      // swaps Dispatchers.Main

    private val topicsRepository = TestTopicsRepository()
    private lateinit var viewModel: TopicViewModel

    @Before
    fun setup() {
        viewModel = TopicViewModel(
            savedStateHandle = SavedStateHandle(mapOf("topicId" to testTopic.id)),
            topicsRepository = topicsRepository,
        )
    }

    @Test
    fun `uiState emits Loading then Success`() = runTest {
        viewModel.uiState.test {                   // Turbine
            assertEquals(TopicUiState.Loading, awaitItem())
            topicsRepository.sendTopics(listOf(testTopic))
            assertTrue(awaitItem() is TopicUiState.Success)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```

```kotlin
// core:testing — the standard main-dispatcher rule
class TestDispatcherRule(
    private val testDispatcher: TestDispatcher = UnconfinedTestDispatcher(),
) : TestWatcher() {
    override fun starting(description: Description) = Dispatchers.setMain(testDispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}
```

Turbine (`app.cash.turbine`) for Flow assertions; `runTest` from
kotlinx-coroutines-test for all coroutine tests.

## DAO Tests — in-memory Room (instrumented)

```kotlin
class TopicDaoTest {
    private lateinit var database: AppDatabase
    private lateinit var topicDao: TopicDao

    @Before
    fun setup() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java,
        ).build()
        topicDao = database.topicDao()
    }

    @After
    fun teardown() = database.close()

    @Test
    fun upsert_then_query_roundtrips() = runTest {
        topicDao.upsertTopics(testTopicEntities)
        assertEquals(testTopicEntities.size, topicDao.getTopicEntities().first().size)
    }
}
```

Migrations get their own tests with `MigrationTestHelper` against the
committed schema JSONs (see data-room.md).

## Compose UI Tests

```kotlin
class TopicScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun successState_showsContent_andFollowCallbackFires() {
        var followClicked = false
        composeTestRule.setContent {
            AppTheme {
                TopicScreen(
                    uiState = TopicUiState.Success(testFollowableTopic, emptyList()),
                    onBackClick = {},
                    onFollowClick = { followClicked = true },
                )
            }
        }
        composeTestRule.onNodeWithText(testFollowableTopic.topic.name).assertIsDisplayed()
        composeTestRule.onNodeWithContentDescription("Follow").performClick()
        assertTrue(followClicked)
    }
}
```

The Route/Screen split makes this possible without Hilt. Full-DI
integration tests use `@HiltAndroidTest` + `HiltAndroidRule` +
`createAndroidComposeRule<HiltComponentActivity>()` with a custom
`AndroidJUnitRunner` that swaps in `HiltTestApplication`.

## Screenshot Tests (Roborazzi)

```bash
./gradlew recordRoborazziDemoDebug    # record baselines
./gradlew verifyRoborazziDemoDebug    # diff against baselines
```

Point them at the same preview composables — previews double as
screenshot coverage.

## Commands

```bash
./gradlew testDebugUnitTest                      # all JVM tests
./gradlew :feature:topic:impl:testDebugUnitTest  # one module
./gradlew connectedDebugAndroidTest              # instrumented
```

(Flavoured repos use variant names: `testDemoDebug` etc.)

## Rules

- Every ViewModel: at least Loading→Success emission + one interaction
  test. Every DAO: roundtrip + every migration. Every Screen: render per
  UiState variant.
- No `Thread.sleep`/`delay` waits — virtual time via `runTest`, Turbine
  `awaitItem`.
- Test doubles live in `core:testing`, shared by unit and instrumented
  tests; fixture data centralised, not copy-pasted.
