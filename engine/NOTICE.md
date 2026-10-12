# Ghi công / Attribution

Thư mục `engine/muse2api/` chứa bản sao nguyên trạng (chỉ bỏ `.git`, file media mẫu
và `docker-compose.yml` của repo gốc) của project **muse2api**:

- Nguồn: https://github.com/bynne2602/muse2api (fork cộng đồng của czg86389-hub/muse2api)
- Giấy phép: MIT — xem file `engine/muse2api/LICENSE`, giữ nguyên khi phân phối lại.
- Mục đích: chạy như **engine Muse tích hợp sẵn** bên trong MuseRouter
  (MuseRouter tự khởi động/quản lý, người dùng không phải cài riêng).
  MuseRouter không sửa code của muse2api; chỉ gọi nó qua HTTP API
  (port nội bộ 18611, CDP 19211) giống cách MuseRouter gọi mọi muse2api instance khác.
