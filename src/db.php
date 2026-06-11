<?php
declare(strict_types=1);

function get_pdo(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $host = getenv('DB_HOST') ?: 'db';
        $name = getenv('DB_NAME') ?: 'ascii_chords_db';
        $user = getenv('DB_USER') ?: 'chords_user';
        $pass = getenv('DB_PASS') ?: 'chords_pass';
        $dsn  = "mysql:host={$host};dbname={$name};charset=utf8mb4";

        // brief retry
        $attempts = 0;
        while (true) {
            try {
                $pdo = new PDO($dsn, $user, $pass, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]);
                break;
            } catch (PDOException $e) {
                if (++$attempts >= 10) { throw $e; }
                sleep(1);
            }
        }
    }
    return $pdo;
}
