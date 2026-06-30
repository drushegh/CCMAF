# Architecture

Google's official guidance as implemented in NowInAndroid. Events flow
down (UI → Domain → Data); data flows up; local storage is the source of
truth.

## Data Layer

Principles: offline-first; repository as the single public API; all
observable data exposed as `Flow<T>` (never `getModel()` snapshots —
always `getModelFlow()` semantics).

```kotlin
// Public interface in core:data
interface TopicsRepository {
    fun getTopics(): Flow<List<Topic>>
    fun getTopic(id: String): Flow<Topic>
    suspend fun syncWith(synchronizer: Synchronizer): Boolean
}

internal class OfflineFirstTopicsRepository @Inject constructor(
    private val topicDao: TopicDao,
    private val network: NetworkDataSource,
) : TopicsRepository {

    override fun getTopics(): Flow<List<Topic>> =
        topicDao.getTopicEntities()
            .map { entities -> entities.map(TopicEntity::asExternalModel) }

    override fun getTopic(id: String): Flow<Topic> =
        topicDao.getTopicEntity(id).map(TopicEntity::asExternalModel)

    override suspend fun syncWith(synchronizer: Synchronizer): Boolean =
        synchronizer.changeListSync(/* fetch changed ids → upsert/delete locally */)
}
```

Data sources: Room DAO (local truth), Retrofit (remote), Proto DataStore
(preferences). The repository owns reconciliation; nothing above it talks
to a data source directly.

## Model Mapping — three model types, mapped at boundaries

```kotlin
fun TopicEntity.asExternalModel() = Topic(id = id, name = name, /* ... */)   // DB → domain
fun NetworkTopic.asEntity() = TopicEntity(id = id, name = name, /* ... */)   // network → DB
```

Network models never reach the UI; entities never leave the data layer;
domain models are pure Kotlin (in `core:model`, no Android imports).

## Sync with WorkManager

```kotlin
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val newsRepository: NewsRepository,
    private val topicsRepository: TopicsRepository,
) : CoroutineWorker(context, params), Synchronizer {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ok = listOf(
            newsRepository.syncWith(this@SyncWorker),
            topicsRepository.syncWith(this@SyncWorker),
        ).all { it }
        if (ok) Result.success() else Result.retry()
    }
}
```

Sync is scheduled work, not something screens trigger; UI observes the
database and updates whenever sync lands.

## Domain Layer (optional)

Add use cases only for: logic reused across ViewModels, combining
multiple repositories, or non-trivial transformations. Don't scaffold
empty pass-through use cases.

```kotlin
class GetUserNewsResourcesUseCase @Inject constructor(
    private val newsRepository: NewsRepository,
    private val userDataRepository: UserDataRepository,
) {
    operator fun invoke(): Flow<List<UserNewsResource>> =
        newsRepository.getNewsResources()
            .combine(userDataRepository.userData) { news, userData ->
                news.mapToUserNewsResources(userData)
            }
}
```

## UI Layer Contract

```kotlin
sealed interface ForYouUiState {
    data object Loading : ForYouUiState
    data class Success(val feed: List<UserNewsResource>) : ForYouUiState
    data class Error(val message: String) : ForYouUiState
}

@HiltViewModel
class ForYouViewModel @Inject constructor(
    getUserNewsResources: GetUserNewsResourcesUseCase,
    private val userDataRepository: UserDataRepository,
) : ViewModel() {

    val uiState: StateFlow<ForYouUiState> =
        getUserNewsResources()
            .map(ForYouUiState::Success)
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = ForYouUiState.Loading,
            )

    fun setBookmarked(id: String, bookmarked: Boolean) {
        viewModelScope.launch {
            userDataRepository.setNewsResourceBookmarked(id, bookmarked)
        }
    }
}
```

`WhileSubscribed(5_000)` keeps the upstream alive across configuration
changes but stops it when the UI truly leaves. Mutations are fire-down
suspend calls into the repository — state updates come back reactively
through the same Flow the UI already observes (no manual state pokes
after writes).

## End-to-End Flow (worked example)

startup → WorkManager enqueues sync → ViewModel maps repository Flow,
emits Loading → sync fetches network → writes Room → DAO Flow emits →
repository maps entity→domain → use case combines with user data →
ViewModel emits Success → screen recomposes. Every arrow is observable;
nothing polls.
