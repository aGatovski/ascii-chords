<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ---------- Helpers --------------------------------------------------------

function json_response($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function require_auth(): int {
    if (empty($_SESSION['user_id'])) {
        json_response(['error' => 'Unauthorized'], 401);
    }
    return (int) $_SESSION['user_id'];
}

function csrf_token(): string {
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void {
    // GET requests are read-only; CSRF check applies only to state-changing methods.
    $method = $_SERVER['REQUEST_METHOD'];
    if (in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf_token'] ?? '');
        if (!hash_equals($_SESSION['csrf'] ?? '', (string)$token)) {
            json_response(['error' => 'Invalid CSRF token'], 403);
        }
    }
}

function clamp_int($v, int $min, int $max, int $default): int {
    if ($v === null || $v === '') return $default;
    $n = (int)$v;
    return max($min, min($max, $n));
}

// ---------- Routing --------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
// Strip leading "/api/"
$path   = preg_replace('#^/api/?#', '', $uri);
$parts  = $path === '' ? [] : explode('/', trim($path, '/'));
$resource = $parts[0] ?? '';
$id       = $parts[1] ?? null;
$action   = $parts[2] ?? null;
$sub      = $parts[3] ?? null;

try {
    switch ($resource) {
        case 'auth':
            handle_auth($id, $method);
            break;
        case 'songs':
            handle_songs($id, $action, $sub, $method);
            break;
        case 'public':
            handle_public($id, $action, $method);
            break;
        case 'chords':
            handle_chords($id, $method);
            break;
        case 'csrf':
            json_response(['token' => csrf_token()]);
        case 'me':
            if (empty($_SESSION['user_id'])) json_response(['user' => null]);
            json_response(['user' => [
                'id' => $_SESSION['user_id'],
                'username' => $_SESSION['username'] ?? null,
            ]]);
        default:
            json_response(['error' => 'Not found', 'path' => $uri], 404);
    }
} catch (Throwable $e) {
    // Always log the full detail server-side; expose it to the client only
    // when APP_DEBUG=1 is set. Production stays opaque.
    error_log('[api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $body = ['error' => 'Server error'];
    if (getenv('APP_DEBUG') === '1') {
        $body['detail'] = $e->getMessage();
    }
    json_response($body, 500);
}

// ---------- Auth -----------------------------------------------------------

function handle_auth(?string $action, string $method): void {
    if ($method !== 'POST') json_response(['error' => 'Method not allowed'], 405);

    $body = json_body();
    $pdo  = get_pdo();

    if ($action === 'register') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if ($username === '' || strlen($username) > 50) {
            json_response(['error' => 'Username must be 1-50 chars'], 400);
        }
        if (strlen($password) < 6) {
            json_response(['error' => 'Password must be at least 6 chars'], 400);
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        try {
            $stmt = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
            $stmt->execute([$username, $hash]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                json_response(['error' => 'Username already taken'], 409);
            }
            throw $e;
        }
        $userId = (int) $pdo->lastInsertId();
        session_regenerate_id(true);
        $_SESSION['user_id']  = $userId;
        $_SESSION['username'] = $username;
        json_response(['user' => ['id' => $userId, 'username' => $username]], 201);
    }

    if ($action === 'login') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $stmt = $pdo->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $u = $stmt->fetch();
        if (!$u || !password_verify($password, $u['password_hash'])) {
            json_response(['error' => 'Invalid credentials'], 401);
        }
        session_regenerate_id(true);
        $_SESSION['user_id']  = (int)$u['id'];
        $_SESSION['username'] = $u['username'];
        json_response(['user' => ['id' => (int)$u['id'], 'username' => $u['username']]]);
    }

    if ($action === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
        json_response(['ok' => true]);
    }

    json_response(['error' => 'Unknown auth action'], 404);
}

// ---------- Songs ----------------------------------------------------------

function song_to_array(array $row): array {
    $row['id']        = (int)$row['id'];
    $row['user_id']   = (int)$row['user_id'];
    $row['year']      = $row['year']      !== null ? (int)$row['year']      : null;
    $row['capo']      = (int)$row['capo'];
    $row['tempo_bpm'] = (int)$row['tempo_bpm'];
    if (array_key_exists('is_public', $row)) {
        $row['is_public'] = (int)$row['is_public'] === 1;
    }
    return $row;
}

function fetch_song_tags(PDO $pdo, int $songId): array {
    $stmt = $pdo->prepare(
        'SELECT t.name FROM tags t
         JOIN song_tags st ON st.tag_id = t.id
         WHERE st.song_id = ?'
    );
    $stmt->execute([$songId]);
    return array_map(fn($r) => $r['name'], $stmt->fetchAll());
}

function set_song_tags(PDO $pdo, int $songId, array $tagNames): void {
    $pdo->prepare('DELETE FROM song_tags WHERE song_id = ?')->execute([$songId]);
    if (!$tagNames) return;
    $insertTag = $pdo->prepare('INSERT IGNORE INTO tags (name) VALUES (?)');
    $findTag   = $pdo->prepare('SELECT id FROM tags WHERE name = ?');
    $linkTag   = $pdo->prepare('INSERT IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)');
    foreach ($tagNames as $name) {
        $name = trim((string)$name);
        if ($name === '') continue;
        $insertTag->execute([$name]);
        $findTag->execute([$name]);
        $tagId = (int) $findTag->fetchColumn();
        if ($tagId > 0) $linkTag->execute([$songId, $tagId]);
    }
}

function handle_songs(?string $id, ?string $action, ?string $sub, string $method): void {
    $pdo = get_pdo();

    // Import endpoint: POST /api/songs/import (multipart upload)
    if ($id === 'import' && $method === 'POST') {
        require_auth();
        require_csrf();
        return_song_import();
    }

    // Collection endpoints
    if ($id === null) {
        if ($method === 'GET')  return_songs_list($pdo);
        if ($method === 'POST') return_songs_create($pdo);
        json_response(['error' => 'Method not allowed'], 405);
    }

    // Item endpoints
    $songId = (int)$id;
    if ($songId <= 0) json_response(['error' => 'Invalid song id'], 400);

    if ($action === 'export' && $method === 'GET') {
        return_song_export($pdo, $songId, $sub ?? 'json');
    }

    switch ($method) {
        case 'GET':    return_song_get($pdo, $songId);
        case 'PUT':    return_song_update($pdo, $songId);
        case 'DELETE': return_song_delete($pdo, $songId);
        default: json_response(['error' => 'Method not allowed'], 405);
    }
}

function return_songs_list(PDO $pdo): void {
    $userId = require_auth();
    $q          = trim((string)($_GET['q'] ?? ''));
    $key        = trim((string)($_GET['key'] ?? ''));
    $difficulty = trim((string)($_GET['difficulty'] ?? ''));
    $genre      = trim((string)($_GET['genre'] ?? ''));
    $tuning     = trim((string)($_GET['tuning'] ?? ''));
    $sort       = (string)($_GET['sort'] ?? 'updated_desc');

    $where = ['user_id = ?'];
    $args  = [$userId];
    if ($q !== '') {
        $where[] = '(title LIKE ? OR artist LIKE ?)';
        $args[]  = '%' . $q . '%';
        $args[]  = '%' . $q . '%';
    }
    if ($key !== '')        { $where[] = 'original_key = ?'; $args[] = $key; }
    if ($difficulty !== '') { $where[] = 'difficulty = ?';   $args[] = $difficulty; }
    if ($genre !== '')      { $where[] = 'genre = ?';        $args[] = $genre; }
    if ($tuning !== '')     { $where[] = 'tuning = ?';       $args[] = $tuning; }

    $orderBy = match ($sort) {
        'title_asc'    => 'title ASC',
        'artist_asc'   => 'artist ASC',
        'updated_asc'  => 'updated_at ASC',
        'difficulty'   => "FIELD(difficulty,'Beginner','Intermediate','Advanced')",
        default        => 'updated_at DESC',
    };

    $sql  = 'SELECT id, user_id, title, artist, album, year, original_key, capo,
                    tuning, tempo_bpm, difficulty, genre, strumming, is_public, updated_at
             FROM songs WHERE ' . implode(' AND ', $where) . " ORDER BY $orderBy";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($args);
    $rows = array_map('song_to_array', $stmt->fetchAll());

    // Attach tags
    foreach ($rows as &$row) {
        $row['tags'] = fetch_song_tags($pdo, $row['id']);
    }
    unset($row);

    json_response(['songs' => $rows]);
}

function build_song_payload_from_body(array $b): array {
    return [
        'title'        => trim((string)($b['title'] ?? '')),
        'artist'       => trim((string)($b['artist'] ?? 'Unknown Artist')),
        'album'        => isset($b['album']) ? trim((string)$b['album']) : null,
        'year'         => isset($b['year']) && $b['year'] !== '' ? (int)$b['year'] : null,
        'original_key' => trim((string)($b['original_key'] ?? 'C')),
        'capo'         => clamp_int($b['capo'] ?? 0, 0, 12, 0),
        'tuning'       => trim((string)($b['tuning'] ?? 'Standard')),
        'tempo_bpm'    => clamp_int($b['tempo_bpm'] ?? 120, 40, 240, 120),
        'difficulty'   => in_array(($b['difficulty'] ?? 'Intermediate'),
                              ['Beginner','Intermediate','Advanced'], true)
                              ? $b['difficulty'] : 'Intermediate',
        'genre'        => isset($b['genre']) ? trim((string)$b['genre']) : null,
        'strumming'    => isset($b['strumming']) ? trim((string)$b['strumming']) : null,
        'notes'        => isset($b['notes']) ? (string)$b['notes'] : null,
        'body'         => (string)($b['body'] ?? ''),
        'is_public'    => !empty($b['is_public']) ? 1 : 0,
        'tags'         => is_array($b['tags'] ?? null) ? $b['tags'] : [],
    ];
}

function return_songs_create(PDO $pdo): void {
    $userId = require_auth();
    require_csrf();
    $body = json_body();
    $p    = build_song_payload_from_body($body);
    if ($p['title'] === '') json_response(['error' => 'Title is required'], 400);

    $stmt = $pdo->prepare(
        'INSERT INTO songs
            (user_id, title, artist, album, year, original_key, capo, tuning,
             tempo_bpm, difficulty, genre, strumming, notes, body, is_public)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $stmt->execute([
        $userId, $p['title'], $p['artist'], $p['album'], $p['year'],
        $p['original_key'], $p['capo'], $p['tuning'], $p['tempo_bpm'],
        $p['difficulty'], $p['genre'], $p['strumming'], $p['notes'], $p['body'],
        $p['is_public'],
    ]);
    $songId = (int)$pdo->lastInsertId();
    set_song_tags($pdo, $songId, $p['tags']);
    return_song_get($pdo, $songId, 201);
}

function return_song_get(PDO $pdo, int $songId, int $code = 200): void {
    // Owner can always read; everyone else can read only if is_public.
    $userId = (int)($_SESSION['user_id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM songs WHERE id = ?');
    $stmt->execute([$songId]);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'Not found'], 404);
    $isOwner  = ((int)$row['user_id'] === $userId && $userId > 0);
    $isPublic = (int)$row['is_public'] === 1;
    if (!$isOwner && !$isPublic) {
        // Hide existence from non-owners on private songs
        if ($userId === 0) json_response(['error' => 'Unauthorized'], 401);
        json_response(['error' => 'Not found'], 404);
    }
    $row = song_to_array($row);
    $row['tags']      = fetch_song_tags($pdo, $songId);
    $row['is_owner']  = $isOwner;
    json_response(['song' => $row], $code);
}

function return_song_update(PDO $pdo, int $songId): void {
    $userId = require_auth();
    require_csrf();

    $stmt = $pdo->prepare('SELECT id FROM songs WHERE id = ? AND user_id = ?');
    $stmt->execute([$songId, $userId]);
    if (!$stmt->fetch()) json_response(['error' => 'Not found'], 404);

    $body = json_body();
    $p    = build_song_payload_from_body($body);
    if ($p['title'] === '') json_response(['error' => 'Title is required'], 400);

    $upd = $pdo->prepare(
        'UPDATE songs SET
            title=?, artist=?, album=?, year=?, original_key=?, capo=?, tuning=?,
            tempo_bpm=?, difficulty=?, genre=?, strumming=?, notes=?, body=?,
            is_public=?
         WHERE id=? AND user_id=?'
    );
    $upd->execute([
        $p['title'], $p['artist'], $p['album'], $p['year'],
        $p['original_key'], $p['capo'], $p['tuning'], $p['tempo_bpm'],
        $p['difficulty'], $p['genre'], $p['strumming'], $p['notes'], $p['body'],
        $p['is_public'],
        $songId, $userId,
    ]);
    set_song_tags($pdo, $songId, $p['tags']);
    return_song_get($pdo, $songId);
}

function return_song_delete(PDO $pdo, int $songId): void {
    $userId = require_auth();
    require_csrf();
    $stmt = $pdo->prepare('DELETE FROM songs WHERE id = ? AND user_id = ?');
    $stmt->execute([$songId, $userId]);
    if ($stmt->rowCount() === 0) json_response(['error' => 'Not found'], 404);
    json_response(['ok' => true]);
}

function safe_filename(string $s): string {
    $s = preg_replace('/[^A-Za-z0-9._-]+/', '_', $s);
    $s = trim($s, '_');
    return $s === '' ? 'song' : $s;
}

function song_to_plain_text(array $song): string {
    $lines  = [];
    $lines[] = '# ' . $song['title'];
    $lines[] = 'Artist: ' . $song['artist'];
    if (!empty($song['album']))  $lines[] = 'Album: '  . $song['album'];
    if (!empty($song['year']))   $lines[] = 'Year: '   . $song['year'];
    $lines[] = 'Key: '   . $song['original_key'];
    $lines[] = 'Tuning: '. $song['tuning'];
    $lines[] = 'Capo: '  . $song['capo'];
    $lines[] = 'Tempo: ' . $song['tempo_bpm'] . ' BPM';
    if (!empty($song['strumming'])) $lines[] = 'Strumming: ' . $song['strumming'];
    $lines[] = '';
    $lines[] = $song['body'];
    return implode("\n", $lines);
}

function return_song_export(PDO $pdo, int $songId, string $format): void {
    $userId = (int)($_SESSION['user_id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM songs WHERE id = ?');
    $stmt->execute([$songId]);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'Not found'], 404);
    $isOwner  = ((int)$row['user_id'] === $userId && $userId > 0);
    $isPublic = (int)$row['is_public'] === 1;
    if (!$isOwner && !$isPublic) {
        if ($userId === 0) json_response(['error' => 'Unauthorized'], 401);
        json_response(['error' => 'Not found'], 404);
    }
    $row = song_to_array($row);
    $row['tags'] = fetch_song_tags($pdo, $songId);

    $base = safe_filename($row['title'] . '-' . $row['artist']);

    if ($format === 'txt') {
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $base . '.txt"');
        echo song_to_plain_text($row);
        exit;
    }
    // default: JSON
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $base . '.json"');
    echo json_encode($row, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

function return_song_import(): void {
    $userId = require_auth();
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_response(['error' => 'Upload failed'], 400);
    }
    $tmp  = $_FILES['file']['tmp_name'];
    $name = $_FILES['file']['name'];
    $raw  = file_get_contents($tmp);
    if ($raw === false) json_response(['error' => 'Cannot read upload'], 400);

    $payload = [];
    if (str_ends_with(strtolower($name), '.json')) {
        $data = json_decode($raw, true);
        if (!is_array($data)) json_response(['error' => 'Invalid JSON'], 400);
        $payload = $data;
    } else {
        // Treat as plain-text body. The user fills in metadata afterwards.
        $payload = [
            'title'  => pathinfo($name, PATHINFO_FILENAME),
            'artist' => 'Unknown Artist',
            'body'   => $raw,
        ];
    }

    json_response(['parsed' => $payload]);
}

// ---------- Chord library --------------------------------------------------

function handle_chords(?string $id, string $method): void {
    $pdo = get_pdo();
    if ($id === null && $method === 'GET') {
        $userId = require_auth();
        $stmt = $pdo->prepare(
            'SELECT id, user_id, chord_name, variant, frets, fingers, barre_fret
             FROM chord_library
             WHERE user_id IS NULL OR user_id = ?
             ORDER BY chord_name, variant'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id']         = (int)$r['id'];
            $r['user_id']    = $r['user_id'] !== null ? (int)$r['user_id'] : null;
            $r['variant']    = (int)$r['variant'];
            $r['barre_fret'] = $r['barre_fret'] !== null ? (int)$r['barre_fret'] : null;
            $r['frets']      = array_map('intval', explode(',', $r['frets']));
            $r['fingers']    = $r['fingers'] !== null
                                ? array_map('intval', explode(',', $r['fingers']))
                                : null;
        }
        json_response(['chords' => $rows]);
    }
    json_response(['error' => 'Method not allowed'], 405);
}

// ---------- Public catalog -------------------------------------------------
// Read-only listing of songs across all users that have is_public=1.
// No authentication required — this is the public face of the site.

function handle_public(?string $id, ?string $action, string $method): void {
    if ($id !== 'songs' || $method !== 'GET') {
        json_response(['error' => 'Not found'], 404);
    }
    $pdo = get_pdo();

    $q          = trim((string)($_GET['q'] ?? ''));
    $key        = trim((string)($_GET['key'] ?? ''));
    $difficulty = trim((string)($_GET['difficulty'] ?? ''));
    $genre      = trim((string)($_GET['genre'] ?? ''));
    $tuning     = trim((string)($_GET['tuning'] ?? ''));
    $sort       = (string)($_GET['sort'] ?? 'updated_desc');

    $where = ['s.is_public = 1'];
    $args  = [];
    if ($q !== '') {
        $where[] = '(s.title LIKE ? OR s.artist LIKE ?)';
        $args[]  = '%' . $q . '%';
        $args[]  = '%' . $q . '%';
    }
    if ($key !== '')        { $where[] = 's.original_key = ?'; $args[] = $key; }
    if ($difficulty !== '') { $where[] = 's.difficulty = ?';   $args[] = $difficulty; }
    if ($genre !== '')      { $where[] = 's.genre = ?';        $args[] = $genre; }
    if ($tuning !== '')     { $where[] = 's.tuning = ?';       $args[] = $tuning; }

    $orderBy = match ($sort) {
        'title_asc'    => 's.title ASC',
        'artist_asc'   => 's.artist ASC',
        'updated_asc'  => 's.updated_at ASC',
        'difficulty'   => "FIELD(s.difficulty,'Beginner','Intermediate','Advanced')",
        default        => 's.updated_at DESC',
    };

    $sql = 'SELECT s.id, s.user_id, s.title, s.artist, s.album, s.year,
                   s.original_key, s.capo, s.tuning, s.tempo_bpm, s.difficulty,
                   s.genre, s.strumming, s.is_public, s.updated_at,
                   u.username AS author
            FROM songs s
            JOIN users u ON u.id = s.user_id
            WHERE ' . implode(' AND ', $where) . " ORDER BY $orderBy LIMIT 200";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($args);
    $rows = array_map(function ($r) {
        $r = song_to_array($r);
        return $r;
    }, $stmt->fetchAll());
    foreach ($rows as &$row) {
        $row['tags'] = fetch_song_tags($pdo, $row['id']);
    }
    unset($row);

    json_response(['songs' => $rows]);
}
