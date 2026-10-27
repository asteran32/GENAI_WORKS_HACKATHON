import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;

/** Uses the platform's bundled JDBC driver; no external libraries to install. */
public class RegisterParquet {
    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) throw new IllegalStateException("Missing " + name);
        return value;
    }

    private static void create(Connection conn, String sql) throws SQLException {
        try (Statement statement = conn.createStatement()) {
            statement.execute(sql);
        } catch (SQLException error) {
            String message = String.valueOf(error.getMessage()).toLowerCase(Locale.ROOT);
            if (!message.contains("already exists") && !message.contains("already registered")) throw error;
            System.out.println("Already registered; checking row count next.");
        }
    }

    public static void main(String[] args) {
        try {
            if (args.length != 2 || !args[0].matches("cool_sydney_[a-f0-9]{16}"))
                throw new IllegalArgumentException("Invalid registration arguments");
            String db = args[0];
            List<String[]> tables = new ArrayList<>();
            Set<String> names = new HashSet<>();
            String prefix = "/home/zetaris/customer-data/shared/cool-sydney-registration/" + db.substring(12) + "/";
            for (String line : Files.readAllLines(Paths.get(args[1]), StandardCharsets.UTF_8)) {
                String[] row = line.split("\t", -1);
                if (row.length != 4 || !row[0].matches("[a-z][a-z0-9_]*") || !names.add(row[0]) ||
                    !row[1].matches("[0-9]+") || !row[2].equals(prefix + row[0] + ".parquet") ||
                    !row[3].matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid table manifest");
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(Paths.get(row[2])));
                StringBuilder hex = new StringBuilder();
                for (byte b : digest) hex.append(String.format("%02x", b & 255));
                if (!hex.toString().equals(row[3])) throw new IllegalStateException("Copy checksum mismatch: " + row[0]);
                tables.add(row);
            }
            Set<String> base = new HashSet<>(Arrays.asList("building", "transportation", "water", "landcover", "landuse", "poi", "walk_nodes", "walk_edges", "trees", "pedestrian_sites", "pedestrian_counts", "weather"));
            Set<String> optional = new HashSet<>(Arrays.asList("agent_catalog", "pedestrian_forecasts", "pedestrian_history", "forecast_backtest"));
            if (!names.containsAll(base)) throw new IllegalStateException("Missing base data tables");
            for (String name : names)
                if (!base.contains(name) && !optional.contains(name) && !name.startsWith("survey_"))
                    throw new IllegalStateException("Unexpected supplemental table");
            Class.forName("com.zetaris.lightning.jdbc.LightningDriver");
            try (Connection conn = DriverManager.getConnection("jdbc:zetaris:lightning@localhost:10000",
                    required("ZETARIS_ADMIN_EMAIL"), required("ZETARIS_ADMIN_PASSWORD"))) {
                create(conn, "CREATE LIGHTNING DATABASE " + db);
                for (String[] row : tables) {
                    create(conn, "CREATE LIGHTNING FILESTORE TABLE " + row[0] + " FROM " + db +
                           " FORMAT PARQUET OPTIONS (path \"" + row[2] + "\")");
                    try (Statement statement = conn.createStatement();
                         ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM " + db + "." + row[0])) {
                        if (!result.next() || result.getLong(1) != Long.parseLong(row[1]))
                            throw new IllegalStateException("Row count mismatch: " + row[0]);
                        System.out.println("PASS " + row[0] + " rows=" + row[1]);
                    }
                }
            }
            System.out.println("VERIFIED " + db + " " + tables.size());
        } catch (Exception error) {
            String message = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
            String password = System.getenv("ZETARIS_ADMIN_PASSWORD");
            if (password != null && !password.isEmpty()) message = message.replace(password, "[redacted]");
            System.err.println(message);
            System.exit(1);
        }
    }
}
