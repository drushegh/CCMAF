# Room and Local Data

## Entities

```kotlin
@Entity(
    tableName = "topics",
    indices = [Index(value = ["name"])],
)
data class TopicEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(defaultValue = "") val shortDescription: String,
)

// Relations: foreign keys + a POJO with @Relation for reads
@Entity(
    tableName = "news_topics",
    primaryKeys = ["newsId", "topicId"],
    foreignKeys = [
        ForeignKey(entity = NewsEntity::class, parentColumns = ["id"],
            childColumns = ["newsId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = TopicEntity::class, parentColumns = ["id"],
            childColumns = ["topicId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("topicId")],
)
data class NewsTopicCrossRef(val newsId: String, val topicId: String)
```

Type converters for non-primitive columns (instants, enums, JSON blobs) —
registered on the database with `@TypeConverters`:

```kotlin
class InstantConverter {
    @TypeConverter
    fun longToInstant(value: Long?): Instant? = value?.let(Instant::fromEpochMilliseconds)
    @TypeConverter
    fun instantToLong(instant: Instant?): Long? = instant?.toEpochMilliseconds()
}
```

## DAOs

```kotlin
@Dao
interface TopicDao {
    @Query("SELECT * FROM topics")
    fun getTopicEntities(): Flow<List<TopicEntity>>     // observable reads → Flow

    @Query("SELECT * FROM topics WHERE id = :topicId")
    fun getTopicEntity(topicId: String): Flow<TopicEntity>

    @Upsert
    suspend fun upsertTopics(entities: List<TopicEntity>)   // writes → suspend

    @Query("DELETE FROM topics WHERE id IN (:ids)")
    suspend fun deleteTopics(ids: List<String>)
}
```

Rules: observable queries return `Flow`; mutations are `suspend`;
`@Upsert` over insert-with-replace for sync upserts; `@Transaction` on
multi-statement operations and `@Relation` reads. Large lists → Paging 3
(`PagingSource` return types).

## Database + Hilt

```kotlin
@Database(entities = [TopicEntity::class, NewsEntity::class], version = 2)
@TypeConverters(InstantConverter::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun topicDao(): TopicDao
}

@Module
@InstallIn(SingletonComponent::class)
internal object DatabaseModule {
    @Provides
    @Singleton
    fun providesAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "app-database").build()

    @Provides
    fun providesTopicDao(database: AppDatabase): TopicDao = database.topicDao()
}
```

## Migrations — never ship destructive fallbacks casually

- Bump `version` with every schema change; export schemas
  (`room.schemaLocation` via the Room Gradle plugin) and commit them —
  they're the migration test fixtures.
- **Auto-migrations** for additive changes:
  `autoMigrations = [AutoMigration(from = 1, to = 2)]` (with
  `@RenameColumn`/`@DeleteTable` specs where needed).
- **Manual `Migration` objects** for data transformations:

```kotlin
val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE topics ADD COLUMN imageUrl TEXT NOT NULL DEFAULT ''")
    }
}
```

- Test every migration with `MigrationTestHelper` (create at old version,
  migrate, assert data survived).
- `fallbackToDestructiveMigration()` deletes user data — acceptable only
  pre-release or for pure caches, and stated explicitly when used.

## DataStore (preferences)

Proto DataStore for typed user settings (theme, onboarding flags) —
exposed as `Flow<UserData>` from its own data source class, consumed via
repositories like any other source. Don't use SharedPreferences in new
code; don't put entity data in DataStore.

## Offline-First Checklist

- UI reads only repository Flows backed by Room.
- Sync writes network results into Room (upsert + tombstone deletes) —
  never straight to UI.
- Conflict strategy chosen deliberately (server-wins change-list sync is
  the NowInAndroid default).
- Migrations tested; schemas committed; no silent destructive fallback.
