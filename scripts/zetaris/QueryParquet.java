import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;

/** Bounded JSON result bridge. SQL arrives over stdin; credentials stay in driver. */
public class QueryParquet {
    private static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
    public static void main(String[] args) {
        try {
            BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            StringBuilder sql = new StringBuilder(); String line;
            while ((line = input.readLine()) != null) {
                sql.append(line).append('\n');
                if (sql.length() > 8200) throw new IllegalArgumentException();
            }
            // Full SQL policy is enforced by the server before this private bridge.
            if (!sql.toString().trim().toUpperCase(java.util.Locale.ROOT).startsWith("SELECT "))
                throw new IllegalArgumentException();
            Class.forName("com.zetaris.lightning.jdbc.LightningDriver");
            try (Connection connection = DriverManager.getConnection("jdbc:zetaris:lightning@localhost:10000",
                    System.getenv("ZETARIS_ADMIN_EMAIL"), System.getenv("ZETARIS_ADMIN_PASSWORD"));
                 Statement statement = connection.createStatement()) {
                statement.setQueryTimeout(45);
                statement.setMaxRows(100);
                try (ResultSet result = statement.executeQuery(sql.toString())) {
                    ResultSetMetaData meta = result.getMetaData();
                    int width = meta.getColumnCount();
                    if (width > 40) throw new IllegalArgumentException();
                    StringBuilder out = new StringBuilder("{\"columns\":[");
                    for (int i=1; i<=width; i++) {
                        if (i>1) out.append(','); out.append(quote(meta.getColumnLabel(i)));
                    }
                    out.append("],\"data\":["); int count=0; boolean truncated=false;
                    while (count < 100 && result.next()) {
                        if (count++>0) out.append(','); out.append('[');
                        for (int i=1; i<=width; i++) {
                            if (i>1) out.append(','); String value = result.getString(i);
                            if (value == null) out.append("null");
                            else { if(value.length()>1000) {value=value.substring(0,1000);truncated=true;} out.append(quote(value)); }
                        }
                        out.append(']');
                    }
                    out.append("],\"cells_truncated\":").append(truncated).append('}');
                    System.out.println("COOL_SYDNEY_JSON=" + out);
                }
            }
        } catch (Exception error) {
            // Driver exceptions can contain credentials or connection strings.
            System.err.println("Zetaris query failed (" + error.getClass().getSimpleName() + "). Check SQL, driver health and registration.");
            System.exit(1);
        }
    }
}
