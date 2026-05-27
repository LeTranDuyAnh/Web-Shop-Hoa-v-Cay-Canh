const fastify = require('fastify')({ logger: true });
const path = require('path');

// 1. Đăng ký Plugin hiển thị Giao diện (Pug)
fastify.register(require('@fastify/view'), {
  engine: { pug: require('pug') },
  root: path.join(__dirname, 'views')
});

// 2. Đăng ký Plugin file tĩnh (CSS/Ảnh)
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', 
});

// 3. Kết nối MongoDB (Thay URL bằng link thực tế của bạn)
fastify.register(require('@fastify/mongodb'), {
  forceClose: true,
  url: 'mongodb://localhost:27017/vnua_flora'
});

// 3.1 Đăng ký plugin xử lý Form
fastify.register(require('@fastify/formbody'));

// 4. Route chính để hiển thị trang Home
// Route chính để hiển thị trang Home - Chỉ lấy 8 sản phẩm mới nhất
// Route chính để hiển thị trang Home
fastify.get('/', async (request, reply) => {
  try {
    const col = fastify.mongo.db.collection('flowers');
    const limit = 9;
    const sort = { _id: -1 };

    // Truy vấn song song tất cả các danh mục để tối ưu tốc độ
    const [
      flowers,
      ornamentalPlants,
      weddingFlowers,
      birthdayFlowers,
      eventFlowers,
      grandOpeningFlowers, // Khai trương
      themedFlowers,       // Chủ đề
      seasonalFlowers,     // Theo mùa
      decorPlants          // Cây trang trí
    ] = await Promise.all([
      col.find({}).sort(sort).limit(limit).toArray(),
      col.find({ category: "Bonsai" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa đám cưới" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa sinh nhật" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa sự kiện" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa khai trương" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa chủ đề" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Hoa theo mùa" }).sort(sort).limit(limit).toArray(),
      col.find({ category: "Cây cảnh trang trí" }).sort(sort).limit(limit).toArray()
    ]);

    return reply.view('home.pug', { 
      flowers, ornamentalPlants, weddingFlowers, birthdayFlowers, 
      eventFlowers, grandOpeningFlowers, themedFlowers, 
      seasonalFlowers, decorPlants,
      cartCount: (request.session.cart || []).reduce((sum, item) => sum + item.qty, 0),
      session: request.session 
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi tải trang chủ");
  }
});

// 5 Route hiển thị danh sách hoa (Read)
fastify.get('/admin', async (request, reply) => {
  try {
    const flowerColl = fastify.mongo.db.collection('flowers');
    const orderColl = fastify.mongo.db.collection('orders');

    // 1. Lấy danh sách toàn bộ hoa để hiển thị bảng
    const flowers = await flowerColl.find().toArray();

    // 2. Đếm số lượng đơn hàng có trạng thái là 'pending'
    const pendingCount = await orderColl.countDocuments({ status: 'pending' });

    // 3. Trả về view kèm theo cả danh sách hoa và số lượng đơn hàng mới
    return reply.view('admin.pug', { 
      flowers, 
      pendingCount 
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tải trang quản trị");
  }
});

// 6 Route thêm hoa mới (Create)
const fs = require('fs');
const pump = require('util').promisify(require('stream').pipeline);

// Đăng ký multipart để đọc file
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 10 * 1024 * 1024 // Cho phép file tối đa 10MB
  }
});

// Route: Thêm hoa mới kèm Upload ảnh
fastify.post('/admin/add', async (request, reply) => {
  const data = await request.file();
  if (!data) return reply.code(400).send('Chưa chọn ảnh');

  const fileName = Date.now() + '-' + data.filename;
  const uploadPath = path.join(__dirname, 'public/uploads', fileName);
  await pump(data.file, fs.createWriteStream(uploadPath));

  const fields = data.fields;
  const newFlower = {
    // Sử dụng ?.value để tránh lỗi undefined
    name: fields.name?.value || 'Chưa đặt tên',
    scientific_name: fields.scientific_name?.value || '',
    
    // PHẦN QUẢN LÝ TÀI CHÍNH & KHO
    category: fields.category?.value || 'Hoa cảnh',
    cost_price: parseInt(fields.cost_price?.value) || 0, // Giá nhập vốn
    price: parseInt(fields.price?.value) || 0,           // Giá bán lẻ
    stock: parseInt(fields.stock?.value) || 0,           // Số lượng tồn kho
    
    image: `/public/uploads/${fileName}`,
    createdAt: new Date() // Nên lưu thêm ngày tạo để làm báo cáo theo tháng sau này
  };

  const collection = fastify.mongo.db.collection('flowers');
  await collection.insertOne(newFlower);
  return reply.redirect('/admin');
});

// Route: Cập nhật hoa (Sửa ảnh hoặc giữ nguyên)
fastify.post('/admin/update/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const data = await request.file();
  const fields = data.fields;
  let updateData = {
    name: fields.name.value,
    scientific_name: fields.scientific_name.value,
    price: parseInt(fields.price.value) || 0
  };

  // Nếu người dùng có chọn ảnh mới thì mới upload
  if (data.filename) {
    const fileName = Date.now() + '-' + data.filename;
    const uploadPath = path.join(__dirname, 'public/uploads', fileName);
    await pump(data.file, fs.createWriteStream(uploadPath));
    updateData.image = `/public/uploads/${fileName}`;
  }

  await fastify.mongo.db.collection('flowers').updateOne(
    { _id: new ObjectId(request.params.id) },
    { $set: updateData }
  );
  return reply.redirect('/admin');
});

// 7 Route xóa hoa (Delete)
fastify.get('/admin/delete/:id', async (request, reply) => {
  const collection = fastify.mongo.db.collection('flowers');
  const { ObjectId } = fastify.mongo;
  await collection.deleteOne({ _id: new ObjectId(request.params.id) });
  return reply.redirect('/admin');
});

fastify.get('/explore', async (request, reply) => {
  try {
    const collection = fastify.mongo.db.collection('flowers');
    const { category, keyword } = request.query;
    
    let filter = {};

    // Nếu có keyword, ta ưu tiên tìm theo tên trên toàn bộ hệ thống
    if (keyword) {
      filter.name = { $regex: keyword, $options: 'i' };
    } 
    // Nếu không có keyword nhưng có category, thì lọc theo category
    else if (category) {
      filter.category = category;
    }

    const flowers = await collection.find(filter).sort({ _id: -1 }).toArray();

    // --- LOGIC NHÓM THEO LOẠI ---
    const groupedFlowers = flowers.reduce((acc, flower) => {
      const cat = flower.category || 'Khác';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(flower);
      return acc;
    }, {});

    const cart = request.session.get('cart') || [];
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

    return reply.view('all_flowers.pug', { 
      groupedFlowers,
      currentCategory: category || 'Tất cả',
      keyword: keyword || '', // Đảm bảo luôn có string để tránh lỗi Pug
      cartCount: totalItems,
      session: { user: request.session.get('user') }
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Error loading flower library");
  }
});

// Route: Hiển thị danh sách Admin
fastify.get('/admin/users', async (request, reply) => {
  const db = fastify.mongo.db;
  
  try {
    // 1. Lấy toàn bộ danh sách users
    const allUsers = await db.collection('users').find().toArray();
    
    // 2. Phân loại và tính toán rank ngay tại Backend
    const processedUsers = allUsers.map(u => {
      let rank = 'Khách mới';
      const pts = u.points || 0;
      
      // Áp dụng logic mốc điểm 1 - 51 - 501
      if (pts >= 501) rank = 'Hạng Kim cương';
      else if (pts >= 51) rank = 'Hạng Vàng';
      else if (pts >= 1) rank = 'Hạng Đồng';
      
      return { ...u, rank };
    });

    // 3. Tách danh sách để đếm tổng số lượng
    const adminList = processedUsers.filter(u => u.role === 'admin');
    const customerList = processedUsers.filter(u => u.role !== 'admin');

    // 4. Đếm số đơn hàng chưa xử lý cho Sidebar
    const pendingCount = await db.collection('orders').countDocuments({ status: 'pending' });

    // 5. Render và gửi dữ liệu
    return reply.view('admin_users.pug', { 
      users: processedUsers, // Danh sách tổng để Pug tự loop hoặc dùng adminList/customerList
      totalAdmins: adminList.length,
      totalCustomers: customerList.length,
      pendingCount: pendingCount
    });

  } catch (err) {
    fastify.log.error(err);
    return reply.redirect('/admin');
  }
});

const bcrypt = require('bcrypt');
const saltRounds = 10; // Độ phức tạp của mã hóa

// Route: Xử lý thêm Admin mới (Có mã hóa mật khẩu)
fastify.post('/admin/users/add', async (request, reply) => {
  try {
    const { username, password, fullName, role } = request.body;
    const collection = fastify.mongo.db.collection('users');
    
    // 1. Kiểm tra xem username đã tồn tại chưa
    const existingUser = await collection.findOne({ username });
    if (existingUser) {
      return reply.code(400).send("Tên đăng nhập đã tồn tại!");
    }

    // 2. Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 3. Lưu vào database
    await collection.insertOne({
      username,
      password: hashedPassword, // Lưu mật khẩu đã mã hóa
      fullName,
      role: role || 'admin',
      createdAt: new Date()
    });

    return reply.redirect('/admin/users');
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tạo tài khoản");
  }
});

// Route: Xóa Admin
fastify.get('/admin/users/delete/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  await fastify.mongo.db.collection('users').deleteOne({ _id: new ObjectId(request.params.id) });
  return reply.redirect('/admin/users');
});

// Đăng ký Cookie và Session để Server "nhớ" trạng thái đăng nhập
fastify.register(require('@fastify/cookie'));
fastify.register(require('@fastify/session'), {
  secret: 'a-secret-key-with-at-least-32-characters-long', // Chuỗi bí mật
  cookie: { secure: false } // Để false khi chạy localhost
});

// --- CHIẾC KHÓA CỔNG (Middleware) ---
// Kiểm tra: Nếu vào link có chữ /admin mà chưa có session user thì đá về /login
// --- CẬP NHẬT CHIẾC KHÓA CỔNG ---
fastify.addHook('preHandler', async (request, reply) => {
  const url = request.url;
  const user = request.session.user;

  // 1. Bảo vệ trang Admin: Phải đăng nhập VÀ có role là admin
  if (url.startsWith('/admin') && (!user || user.role !== 'admin')) {
    return reply.redirect('/login?error=admin_only');
  }

  // 2. Bảo vệ trang cá nhân/thanh toán của Khách hàng
  const customerRoutes = ['/checkout', '/my-orders', '/profile'];
  if (customerRoutes.some(route => url.startsWith(route)) && !user) {
    return reply.redirect('/login?error=login_required');
  }
});

// 1. Hiển thị trang Login
fastify.get('/login', async (request, reply) => {
  return reply.view('login.pug');
});

// 2. Xử lý dữ liệu khi bấm nút Login
fastify.post('/login', async (request, reply) => {
  const { username, password } = request.body;
  const user = await fastify.mongo.db.collection('users').findOne({ username });
  
  if (user && await bcrypt.compare(password, user.password)) {
    // Lưu thông tin vào session
    request.session.user = { 
      id: user._id, 
      name: user.fullName, 
      role: user.role,
      phone: user.phone,
      address: user.address 
    };

    // Điều hướng dựa trên quyền
    if (user.role === 'admin') {
      return reply.redirect('/admin');
    } else {
      return reply.redirect('/'); // Khách về trang chủ
    }
  }
  
  return reply.view('login.pug', { error: 'Sai tài khoản hoặc mật khẩu!' });
});

// 3. Đăng xuất (Logout)
fastify.get('/logout', async (request, reply) => {
  request.session.destroy();
  return reply.redirect('/');
});


//4. User login
// A. Hiển thị trang đăng ký
fastify.get('/register', async (request, reply) => {
  return reply.view('register.pug');
});

// B. Xử lý đăng ký
fastify.post('/register', async (request, reply) => {
  try {
    const { username, password, fullName, phone, address } = request.body;
    const collection = fastify.mongo.db.collection('users');

    const existingUser = await collection.findOne({ username });
    if (existingUser) return reply.view('register.pug', { error: 'Tên đăng nhập đã tồn tại!' });

    const hashedPassword = await bcrypt.hash(password, 10);

    await collection.insertOne({
      username,
      password: hashedPassword,
      fullName,
      phone,   // Lưu sẵn SĐT để lúc mua hàng không phải nhập lại
      address, // Lưu sẵn địa chỉ
      role: 'customer', // Mặc định là khách hàng
      createdAt: new Date()
    });

    return reply.redirect('/login?msg=success');
  } catch (err) {
    return reply.code(500).send("Lỗi đăng ký");
  }
});

fastify.get('/flower/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  try {
    const flower = await fastify.mongo.db.collection('flowers').findOne({ 
      _id: new ObjectId(request.params.id) 
    });
    
    if (!flower) {
      return reply.code(404).send('Không tìm thấy hoa!');
    }
    
    return reply.view('flower_detail.pug', { flower });
  } catch (err) {
    return reply.code(500).send('Lỗi hệ thống');
  }
});



fastify.get('/admin/edit/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  try {
    const flower = await fastify.mongo.db.collection('flowers').findOne({ 
      _id: new ObjectId(request.params.id) 
    });

    if (!flower) {
      return reply.code(404).send('Không tìm thấy loài hoa này!');
    }

    return reply.view('edit_flower.pug', { flower });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send('Lỗi định dạng ID hoặc lỗi Server');
  }
});

fastify.post('/admin/edit/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const parts = request.parts(); // Sử dụng parts() để duyệt qua toàn bộ form
  let updateData = {};
  let hasFile = false;

  for await (const part of parts) {
    if (part.file) {
      // Xử lý File ảnh
      if (part.filename) {
        hasFile = true;
        const fileName = Date.now() + '-' + part.filename;
        const uploadPath = path.join(__dirname, 'public/uploads', fileName);
        await pump(part.file, fs.createWriteStream(uploadPath));
        updateData.image = `/public/uploads/${fileName}`;
      } else {
        // Nếu không có file mới, phải tiêu thụ stream để tránh treo request
        await part.file.resume();
      }
    } else {
      // Xử lý các Field text
      // Chỉ thêm vào updateData nếu field đó có giá trị (tránh ghi đè rỗng)
      if (part.value !== undefined) {
        const fieldName = part.fieldname;
        let value = part.value;

        // Ép kiểu dữ liệu
        if (['cost_price', 'stock'].includes(fieldName)) value = parseInt(value) || 0;
        if (fieldName === 'price') value = parseFloat(value) || 0;

        updateData[fieldName] = value;
      }
    }
  }

  try {
    // Kiểm tra nếu updateData trống (không có gì thay đổi)
    if (Object.keys(updateData).length === 0) {
      return reply.redirect('/admin');
    }

    await fastify.mongo.db.collection('flowers').updateOne(
      { _id: new ObjectId(request.params.id) },
      { $set: updateData } // Chỉ update những gì có trong form gửi lên
    );
    
    return reply.redirect('/admin');
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi cập nhật database");
  }
});


// --- QUẢN LÝ THƯ VIỆN TRA CỨU (WIKI) ---

// A. Hiển thị danh sách quản lý
// Route: Hiển thị danh sách Thư viện Wiki
fastify.get('/admin/library', async (request, reply) => {
  const db = fastify.mongo.db;
  
  // 1. Lấy dữ liệu thư viện loài hoa (sắp xếp mới nhất lên đầu)
  const collection = db.collection('flora_library');
  const flora = await collection.find().sort({ createdAt: -1 }).toArray();
  
  // 2. ĐẾM SỐ ĐƠN HÀNG (Để sidebar hiện thông báo nhấp nháy)
  // Lưu ý: Tên collection 'orders' phải khớp với database của bạn
  const pendingCount = await db.collection('orders').countDocuments({ status: 'pending' });

  // 3. Trả về giao diện kèm theo cả 2 dữ liệu
  return reply.view('admin_library.pug', { 
    flora, 
    pendingCount // <--- Thiếu cái này là Sidebar không hiện số thông báo đâu nhé!
  });
});

// B. Form thêm mới (Đã có file Pug ở tin nhắn trước)
fastify.get('/admin/library/add', async (request, reply) => {
  return reply.view('add_library.pug');
});

// C. Xử lý thêm mới
fastify.post('/admin/library/add', async (request, reply) => {
  const data = await request.file();
  if (!data) return reply.code(400).send('Thiếu thông tin');

  const fileName = 'wiki-' + Date.now() + '-' + data.filename;
  const uploadDir = path.join(__dirname, 'public/uploads/library');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const uploadPath = path.join(uploadDir, fileName);
  await pump(data.file, fs.createWriteStream(uploadPath));

  const fields = data.fields;

  // Đóng gói dữ liệu theo cấu trúc "Sâu"
  const newEntry = {
    common_name: fields.common_name?.value || '',
    scientific_name: fields.scientific_name?.value || '',
    // Gom nhóm Taxonomy
    taxonomy: {
      family: fields.family?.value || 'Chưa rõ',
      genus: fields.genus?.value || 'Chưa rõ',
      order: fields.order?.value || 'Chưa rõ'
    },
    // Gom nhóm Hình thái
    morphology: {
      flower: fields.flower_desc?.value || '',
      leaf: fields.leaf_desc?.value || ''
    },
    // Gom nhóm Sinh thái
    ecology: {
      soil_ph: fields.ph?.value || '',
      temperature: fields.temp?.value || '',
      origin: fields.origin?.value || ''
    },
    // Gom nhóm Di sản
    heritage: {
      symbolism: fields.symbolism?.value || '',
      medicinal: fields.medicinal?.value || ''
    },
    image: `/public/uploads/library/${fileName}`,
    createdAt: new Date()
  };

  await fastify.mongo.db.collection('flora_library').insertOne(newEntry);
  return reply.redirect('/admin/library');
});

// D. Form chỉnh sửa
fastify.get('/admin/library/edit/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const item = await fastify.mongo.db.collection('flora_library').findOne({
    _id: new ObjectId(request.params.id)
  });
  return reply.view('edit_library.pug', { item });
});

// E. Xử lý cập nhật (Đã sửa để khớp với cấu trúc sâu)
fastify.post('/admin/library/edit/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const data = await request.file();
  console.log("FIELDS NHẬN ĐƯỢC:", data.fields);
  if (!data) return reply.code(400).send('Không nhận được dữ liệu');
  
  const f = data.fields;
  
  // Chuẩn bị object update theo cấu trúc lồng nhau (Nested Object)
  let updateData = {
    common_name: f.common_name?.value || '',
    scientific_name: f.scientific_name?.value || '',
    taxonomy: {
      family: f.family?.value || 'Chưa rõ',
      genus: f.genus?.value || 'Chưa rõ',
      order: f.order?.value || 'Chưa rõ'
    },
    morphology: {
      flower: f.flower_desc?.value || '',
      leaf: f.leaf_desc?.value || ''
    },
    ecology: {
      soil_ph: f.ph?.value || '',
      temperature: f.temp?.value || '',
      origin: f.origin?.value || ''
    },
    heritage: {
      symbolism: f.symbolism?.value || '',
      medicinal: f.medicinal?.value || ''
    }
  };

  // Nếu có upload ảnh mới thì mới xử lý lưu file
  if (data.filename) {
    const fileName = 'wiki-' + Date.now() + '-' + data.filename;
    const uploadPath = path.join(__dirname, 'public/uploads/library', fileName);
    await pump(data.file, fs.createWriteStream(uploadPath));
    updateData.image = `/public/uploads/library/${fileName}`;
  }

  try {
    await fastify.mongo.db.collection('flora_library').updateOne(
      { _id: new ObjectId(request.params.id) },
      { $set: updateData }
    );
    return reply.redirect('/admin/library');
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi cập nhật dữ liệu chuyên sâu");
  }
});

// F. Xử lý xóa
fastify.get('/admin/library/delete/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  await fastify.mongo.db.collection('flora_library').deleteOne({
    _id: new ObjectId(request.params.id)
  });
  return reply.redirect('/admin/library');
});

// G. Route tra cứu chi tiết cho khách (Frontend)
fastify.get('/wiki', async (request, reply) => {
  try {
    const collection = fastify.mongo.db.collection('flora_library');
    const flora = await collection.find({}).sort({ createdAt: -1 }).toArray();
    
    // --- LẤY DỮ LIỆU GIỎ HÀNG VÀ USER TỪ SESSION ---
    const cart = request.session.get('cart') || [];
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const user = request.session.get('user');

    // Truyền đầy đủ các biến cần thiết sang View
    return reply.view('wiki_list.pug', { 
      flora, 
      cartCount: totalItems, 
      session: { user: user } 
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tải thư viện");
  }
});

// Route hiển thị chi tiết 1 loài trong thư viện
fastify.get('/wiki/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  try {
    const entry = await fastify.mongo.db.collection('flora_library').findOne({
      _id: new ObjectId(request.params.id)
    });
    if (!entry) return reply.code(404).send('Không tìm thấy thông tin');
    
    return reply.view('wiki_detail.pug', { entry });
  } catch (err) {
    return reply.code(500).send('Lỗi hệ thống');
  }
});;



fastify.post('/cart/add', async (request, reply) => {
  const { flowerId } = request.body; // Chỉ cần ID là đủ
  const { ObjectId } = fastify.mongo;

  // 1. Tìm thông tin hoa thật trong Database
  const flower = await fastify.mongo.db.collection('flowers').findOne({ 
    _id: new ObjectId(flowerId) 
  });

  if (!flower) return reply.code(404).send('Sản phẩm không tồn tại');

  if (!request.session.cart) {
    request.session.cart = [];
  }
  
  const cart = request.session.cart;
  const existingItemIndex = cart.findIndex(item => item.id === flowerId);

  if (existingItemIndex > -1) {
    cart[existingItemIndex].qty += 1;
  } else {
    // 2. Lưu thông tin từ DB vào giỏ để đảm bảo giá và ảnh luôn đúng
    cart.push({
      id: flowerId,
      name: flower.name,
      price: flower.price, 
      image: flower.image,
      qty: 1
    });
  }

  request.session.cart = [...cart]; 
  return reply.redirect('/cart');
});

// --- 3. Route Hiển thị trang giỏ hàng ---
fastify.get('/cart', async (request, reply) => {
  // 1. Lấy giỏ hàng từ session
  const cart = request.session.cart || [];
  
  // 2. Tính tổng tiền tạm tính
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  // 3. Lấy thông tin voucher đã áp dụng (nếu có) từ session
  // Biến này được tạo ra sau khi Route /cart/apply-voucher chạy thành công
  const appliedVoucher = request.session.appliedVoucher || null;

  // 4. Render và truyền đầy đủ các biến sang file cart.pug
  return reply.view('cart.pug', { 
    cart, 
    total, 
    appliedVoucher 
  });
});

// --- 4. Route Xóa sản phẩm khỏi giỏ ---
fastify.get('/cart/remove/:id', async (request, reply) => {
  
  if (request.session.cart) {
    request.session.cart = request.session.cart.filter(item => item.id !== request.params.id);
  }
  return reply.redirect('/cart');
});

// A. Hiển thị trang thanh toán
fastify.get('/checkout', async (request, reply) => {
  const cart = request.session.cart || [];
  if (cart.length === 0) return reply.redirect('/');

  const user = request.session.user || null; 

  // THÊM CONSOLE LOG ĐỂ KIỂM TRA DỮ LIỆU
  console.log("--- DEBUG CHECKOUT ---");
  console.log("User object:", JSON.stringify(user, null, 2));
  console.log("Full Name trực tiếp:", user ? user.fullName : "User is null");
  console.log("----------------------");

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const appliedVoucher = request.session.appliedVoucher || null;

  return reply.view('checkout.pug', { 
    cart, 
    total, 
    appliedVoucher, 
    user 
  });
});

// B. Xử lý lưu Đơn hàng vào Database
fastify.post('/place-order', async (request, reply) => {
  const user = request.session.user;
  if (!user) return reply.redirect('/login?error=vui-long-dang-nhap');

  // [MỚI]: Lấy thêm paymentMethod từ form gửi lên
  const { customerName, phone, address, note, deliveryTime, paymentMethod } = request.body;
  const cart = request.session.cart || [];
  const appliedVoucher = request.session.appliedVoucher || null; 

  if (cart.length === 0) return reply.redirect('/');

  const { ObjectId } = fastify.mongo;
  const flowerColl = fastify.mongo.db.collection('flowers');
  const orderColl = fastify.mongo.db.collection('orders');
  const voucherColl = fastify.mongo.db.collection('vouchers');

  try {
    const orderItems = [];

    // 1. Cập nhật kho hàng
    await Promise.all(cart.map(async (item) => {
      const flowerId = new ObjectId(item.id);
      const quantityToSubtract = parseInt(item.qty) || 0;
      const flowerInfo = await flowerColl.findOne({ _id: flowerId });
      
      orderItems.push({
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        image: item.image, // [MỚI]: Lưu thêm ảnh để hiển thị ở trang thành công/admin
        cost_price: flowerInfo ? (flowerInfo.cost_price || 0) : 0 
      });

      return flowerColl.updateOne(
        { _id: flowerId },
        { $inc: { stock: -quantityToSubtract } }
      );
    }));

    const subTotal = orderItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const discountAmount = appliedVoucher ? appliedVoucher.discountAmount : 0;
    const finalTotal = Math.max(0, subTotal - discountAmount);

    // 2. Tạo đối tượng đơn hàng mới
    const newOrder = {
      userId: new ObjectId(user.id || user._id),
      
      // SỬA Ở ĐÂY: Lưu trực tiếp senderName và senderPhone
      senderName: user.name, 
      senderPhone: user.phone || 'Chưa cập nhật',
      
      orderedBy: {
        username: user.username,
        fullName: user.name
      },
      customer: { 
        name: customerName || user.name,
        phone: phone || user.phone,
        address: address || user.address,
        note,
        deliveryTime 
      },
      items: orderItems,
      subTotal: subTotal,
      appliedVoucher: appliedVoucher,
      totalAmount: finalTotal,
      
      // [MỚI]: Lưu phương thức và trạng thái thanh toán
      paymentMethod: paymentMethod || 'COD', 
      paymentStatus: (paymentMethod === 'BANK') ? 'unpaid' : 'pending_cod',
      
      status: 'pending',
      createdAt: new Date()
    };

    const result = await orderColl.insertOne(newOrder);

    // 3. Đánh dấu Voucher đã dùng
    if (appliedVoucher && appliedVoucher.code) {
      await voucherColl.updateOne(
        { code: appliedVoucher.code.toUpperCase() },
        { 
          $addToSet: { usedBy: (user.id || user._id).toString() },
          $inc: { usedCount: 1 } 
        }
      );
    }

    // 4. Dọn dẹp session
    request.session.cart = [];
    request.session.appliedVoucher = null; 
    
    // 5. Render trang thành công (Sử dụng orderId mới để tạo mã VietQR)
    return reply.view('order_success.pug', { 
      order: { ...newOrder, _id: result.insertedId },
      session: request.session
    });

  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi hệ thống khi xử lý đơn hàng");
  }
});

// Route xem đơn hàng (Giữ nguyên như bản sửa ObjectId trước đó)
fastify.get('/my-orders', async (request, reply) => {
  if (!request.session.user) return reply.redirect('/login');
  const { ObjectId } = fastify.mongo; 
  try {
    const orders = await fastify.mongo.db.collection('orders')
      .find({ userId: new ObjectId(request.session.user.id) })
      .sort({ createdAt: -1 })
      .toArray();

    return reply.view('my_orders.pug', { 
      orders,
      session: request.session
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tải danh sách đơn hàng");
  }
});

fastify.get('/order-detail/:id', async (request, reply) => {
  if (!request.session.user) return reply.redirect('/login');
  
  const { ObjectId } = fastify.mongo;
  try {
    const order = await fastify.mongo.db.collection('orders').findOne({ 
      _id: new ObjectId(request.params.id),
      userId: new ObjectId(request.session.user.id || request.session.user._id) 
    });

    if (!order) return reply.status(404).send("Không tìm thấy đơn hàng!");

    return reply.view('order_detail_view.pug', { order });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi tải chi tiết đơn hàng");
  }
});


// B. Route Tra cứu đơn hàng (Dành cho khách hàng)
fastify.get('/track-order', async (request, reply) => {
  const { phone } = request.query;
  let orders = [];
  if (phone) {
    orders = await fastify.mongo.db.collection('orders')
      .find({ "customer.phone": phone })
      .sort({ createdAt: -1 })
      .toArray();
  }
  return reply.view('order_tracking.pug', { orders, searchedPhone: phone });
});

// Route: Hiển thị danh sách đơn hàng cho Admin
fastify.get('/admin/orders', async (request, reply) => {
  try {
    const orderColl = fastify.mongo.db.collection('orders');
    
    // 1. Lấy danh sách đơn hàng như cũ
    const orders = await orderColl.find({}).sort({ createdAt: -1 }).toArray();
    
    // 2. Đếm số đơn hàng đang chờ (pending) để hiện Badge
    const pendingCount = await orderColl.countDocuments({ status: 'pending' });
    
    // 3. Truyền pendingCount sang file Pug
    return reply.view('admin_orders.pug', { orders, pendingCount });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi tải danh sách đơn hàng");
  }
});

fastify.post('/admin/orders/update-status/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const { status, reason } = request.body;
  const orderId = request.params.id;
  
  try {
    const orderColl = fastify.mongo.db.collection('orders');
    const userColl = fastify.mongo.db.collection('users');

    // 1. Lấy thông tin đơn hàng trước khi update
    const order = await orderColl.findOne({ _id: new ObjectId(orderId) });
    if (!order) return reply.code(404).send("Không tìm thấy đơn hàng");

    const updateData = { 
      status: status,
      updatedAt: new Date()
    };
    if (reason) updateData.adminFeedback = reason;

    // 2. XỬ LÝ LOGIC KHI HOÀN TẤT ĐƠN HÀNG
    if (status === 'completed') {
      updateData.completedAt = new Date();

      // Chỉ cộng điểm nếu đơn hàng chưa từng được "completed" trước đó (tránh cộng trùng)
      if (order.status !== 'completed' && order.userId) {
        const pointsEarned = Math.floor(order.totalAmount / 10000); // 10k = 1 điểm
        
        // Cập nhật điểm và tổng chi tiêu cho User
        await userColl.updateOne(
          { _id: new ObjectId(order.userId) },
          { 
            $inc: { 
              points: pointsEarned, 
              totalSpent: order.totalAmount 
            } 
          }
        );

        // Kiểm tra và Nâng hạng thành viên
        const updatedUser = await userColl.findOne({ _id: new ObjectId(order.userId) });
        let newRank = 'Thành viên Bạc';
        if (updatedUser.totalSpent >= 5000000) newRank = 'Thành viên Kim cương';
        else if (updatedUser.totalSpent >= 2000000) newRank = 'Thành viên Vàng';

        if (updatedUser.rank !== newRank) {
          await userColl.updateOne(
            { _id: new ObjectId(order.userId) },
            { $set: { rank: newRank } }
          );
        }
      }
    }

    // 3. Cập nhật trạng thái đơn hàng
    await orderColl.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });

    return reply.redirect('/admin/orders');
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi hệ thống");
  }
});

// Route: Tăng số lượng (+1)
fastify.get('/cart/increase/:id', async (request, reply) => {
  const cart = request.session.cart || [];
  const found = cart.find(item => item.id === request.params.id);
  
  if (found) {
    found.qty += 1;
    request.session.cart = [...cart]; // Cập nhật lại session
  }
  return reply.redirect('/cart');
});

// Route: Giảm số lượng (-1)
fastify.get('/cart/decrease/:id', async (request, reply) => {
  const cart = request.session.cart || [];
  const foundIndex = cart.findIndex(item => item.id === request.params.id);
  
  if (foundIndex > -1) {
    if (cart[foundIndex].qty > 1) {
      cart[foundIndex].qty -= 1;
    } else {
      // Nếu giảm xuống 0 thì xóa luôn món đó khỏi giỏ
      cart.splice(foundIndex, 1);
    }
    request.session.cart = [...cart];
  }
  return reply.redirect('/cart');
});


// Route: Khách hàng tự hủy đơn hàng
fastify.get('/order/cancel/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  const orderColl = fastify.mongo.db.collection('orders');
  const flowerColl = fastify.mongo.db.collection('flowers');

  try {
    const order = await orderColl.findOne({ _id: new ObjectId(request.params.id) });

    // Chỉ hoàn kho nếu đơn đang 'pending' và chưa bị 'cancelled' trước đó
    if (order && order.status === 'pending') {
      
      // LOGIC HOÀN KHO CHI TIẾT
      for (const item of order.items) {
        const qtyToReturn = parseInt(item.qty) || 0;
        console.log(`Đang hoàn lại ${qtyToReturn} sản phẩm cho: ${item.name}`);

        // Sử dụng $inc với số dương để cộng vào
        await flowerColl.updateOne(
          { _id: new ObjectId(item.id) },
          { $inc: { stock: qtyToReturn } }
        );
      }

      // Sau khi cộng kho xong mới đổi trạng thái đơn
      await orderColl.updateOne(
        { _id: new ObjectId(request.params.id) },
        { $set: { status: 'cancelled' } }
      );

      return reply.view('order_cancelled_success.pug');
    } else {
      return reply.code(400).send("Đơn hàng không thể hủy hoặc đã được xử lý.");
    }
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi hoàn kho");
  }
});

// Route: Xem chi tiết hóa đơn (Admin)
fastify.get('/admin/orders/detail/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  try {
    const order = await fastify.mongo.db.collection('orders').findOne({ 
      _id: new ObjectId(request.params.id) 
    });

    if (!order) return reply.code(404).send('Không tìm thấy đơn hàng');

    // --- LOG KIỂM TRA DỮ LIỆU ---
    console.log("--- DEBUG ORDER DATA ---");
    console.log("ID đơn hàng:", order._id);
    console.log("Người gửi (Sender):", { 
      name: order.senderName, 
      phone: order.senderPhone 
    });
    console.log("Người nhận (Customer/Receiver):", order.customer);
    // ----------------------------

    return reply.view('admin_order_detail.pug', { order });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send('Lỗi hệ thống');
  }
});
// Route: Làm trống hoàn toàn giỏ hàng
fastify.get('/cart/clear', async (request, reply) => {
  request.session.cart = [];
  return reply.redirect('/cart');
});

// Route: Báo cáo tài chính (Analytics)
fastify.get('/admin/analytics', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    const orderColl = db.collection('orders');
    
    // 1. Lấy tất cả đơn hàng đã hoàn thành để tính toán
    const completedOrders = await orderColl.find({ status: 'completed' }).toArray();

    // 2. ĐẾM SỐ ĐƠN HÀNG MỚI (Để Sidebar hiện badge nhấp nháy)
    const pendingCount = await orderColl.countDocuments({ status: 'pending' });

    let totalRevenue = 0;
    let totalCost = 0;
    const flowerSales = {}; 
    const dailySales = {};  
    const customerStats = {}; // <--- Thêm object này để gom nhóm khách hàng

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    completedOrders.forEach(order => {
      totalRevenue += (order.totalAmount || 0);
      
      const orderDate = new Date(order.createdAt);
      const dateKey = order.createdAt ? orderDate.toISOString().split('T')[0] : 'Không rõ ngày';
      dailySales[dateKey] = (dailySales[dateKey] || 0) + (order.totalAmount || 0);

      // Logic tính giá vốn và số lượng hoa bán ra
      if (order.items) {
        order.items.forEach(item => {
          totalCost += (item.cost_price || 0) * (item.qty || 0);
          flowerSales[item.name] = (flowerSales[item.name] || 0) + parseInt(item.qty || 0);
        });
      }

      // --- LOGIC MỚI: Thống kê khách hàng trong tháng hiện tại ---
      if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
        const phone = order.customer.phone;
        if (!customerStats[phone]) {
          customerStats[phone] = {
            name: order.senderName || 'N/A',      // Lấy từ senderName
            receiverName: order.customer.name,    // Lấy từ customer.name
            phone: phone,
            orderCount: 0,
            totalSpent: 0
          };
        }
        customerStats[phone].orderCount += 1;
        customerStats[phone].totalSpent += (order.totalAmount || 0);
        // Cập nhật tên người nhận là người nhận của đơn hàng gần nhất
        customerStats[phone].receiverName = order.customer.name; 
      }
    });

    // Chuyển object khách hàng thành mảng và sắp xếp ai mua nhiều nhất lên đầu
    const monthlyCustomers = Object.values(customerStats)
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10); // Lấy top 10 người mua nhiều nhất

    const topFlowers = Object.entries(flowerSales)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const dailyReport = Object.entries(dailySales)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 7);

    // 3. Trả về view
    return reply.view('admin_analytics.pug', { 
      pendingCount,
      stats: {
        totalRevenue,
        totalCost,
        totalProfit: totalRevenue - totalCost,
        orderCount: completedOrders.length,
        topFlowers,
        dailyReport,
        monthlyCustomers // <--- Truyền danh sách này sang file PUG
      }
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi xử lý dữ liệu");
  }
});


// Route: Xóa sạch toàn bộ đơn hàng để làm lại từ đầu
fastify.get('/admin/clear-orders', async (request, reply) => {
  try {
    const orderColl = fastify.mongo.db.collection('orders');
    
    // Lệnh xóa không điều kiện (xóa sạch bách)
    const result = await orderColl.deleteMany({});
    
    console.log(`Đã xóa thành công ${result.deletedCount} đơn hàng cũ.`);
    
    // Xóa xong thì quay về trang báo cáo (lúc này sẽ hiện toàn số 0)
    return reply.redirect('/admin/analytics');
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi dọn dẹp đơn hàng");
  }
});


fastify.get('/profile', async (request, reply) => {
  const sessionUser = request.session.user;
  if (!sessionUser) return reply.redirect('/login');

  try {
    const currentId = sessionUser._id || sessionUser.id;
    
    // 1. Lấy thông tin user mới nhất từ Database
    const userFromDb = await fastify.mongo.db.collection('users').findOne({ 
      _id: new fastify.mongo.ObjectId(currentId) 
    });

    // 2. Lấy danh sách đơn hàng của user đó
    const orders = await fastify.mongo.db.collection('orders')
      .find({ 
        $or: [
          { userId: new fastify.mongo.ObjectId(currentId) },
          { userId: currentId }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();

    // 3. Logic phân hạng dựa trên Flora Points (1-51-501)
    let pts = 0;
    let rank = 'Khách mới';

    if (userFromDb) {
      pts = userFromDb.points || 0;
      if (pts >= 501) rank = 'Hạng Kim cương';
      else if (pts >= 51) rank = 'Hạng Vàng';
      else if (pts >= 1) rank = 'Hạng Đồng';
    }

    const userData = userFromDb ? { ...userFromDb, points: pts, rank: rank } : { ...sessionUser, points: 0, rank: 'Khách mới' };

    return reply.view('profile.pug', { 
      user: userData,
      orders: orders || [], 
      session: request.session 
    });
  } catch (err) {
    console.error("Lỗi Profile:", err);
    return reply.view('profile.pug', { user: sessionUser, orders: [], session: request.session });
  }
});


// Route: Xem chi tiết người dùng (Chuẩn Fastify + MongoDB)
fastify.get('/admin/users/detail/:id', async (request, reply) => {
  const { ObjectId } = fastify.mongo;
  try {
    const userId = request.params.id;

    // 1. Tìm người dùng
    const user = await fastify.mongo.db.collection('users').findOne({ 
      _id: new ObjectId(userId) 
    });

    if (!user) {
      return reply.redirect('/admin/users?error=notfound');
    }

    // 2. Logic phân hạng dựa trên điểm (1-51-501)
    const pts = user.points || 0;
    let currentRank = 'Khách mới';
    if (pts >= 501) currentRank = 'Hạng Kim cương';
    else if (pts >= 51) currentRank = 'Hạng Vàng';
    else if (pts >= 1) currentRank = 'Hạng Đồng';

    // Gán rank vào object user để gửi sang Pug
    user.rank = currentRank;
    user.points = pts;

    // 3. Tìm danh sách đơn hàng
    const orders = await fastify.mongo.db.collection('orders')
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();

    return reply.view('admin_user_detail.pug', { 
      user: user, 
      orders: orders 
    });

  } catch (err) {
    fastify.log.error(err);
    return reply.redirect('/admin/users');
  }
});



fastify.get('/blog', async (request, reply) => {
  try {
    const posts = await fastify.mongo.db.collection('posts')
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    // --- LẤY DỮ LIỆU GIỎ HÀNG VÀ USER TỪ SESSION ---
    const cart = request.session.get('cart') || [];
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const user = request.session.get('user');

    // Gửi đầy đủ sang view blog.pug
    return reply.view('blog.pug', { 
      posts, 
      cartCount: totalItems, 
      session: { user: user } 
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tải trang blog");
  }
});

fastify.get('/blog/:slug', async (request, reply) => {
  const { slug } = request.params;
  const db = fastify.mongo.db;
  const { ObjectId } = fastify.mongo;

  // 1. Thử tìm theo slug trước
  let post = await db.collection('posts').findOne({ slug: slug });

  // 2. Nếu không thấy và slug có định dạng giống ID (24 ký tự), thử tìm theo _id
  if (!post && slug.length === 24) {
    try {
      post = await db.collection('posts').findOne({ _id: new ObjectId(slug) });
    } catch (e) {
      // ID không hợp lệ thì bỏ qua
    }
  }

  if (!post) return reply.code(404).send('Không tìm thấy bài viết');
  
  return reply.view('blog_detail.pug', { post });
});


// Route hiển thị trang viết blog
const { pipeline } = require('stream/promises');
// 1. Route hiển thị trang soạn thảo
fastify.get('/admin/blog/create', async (request, reply) => {
  // Lấy tất cả bài viết từ DB để hiện ở danh sách bên dưới form
  const pendingCount = await fastify.mongo.db.collection('orders')
    .countDocuments({ status: 'pending' });
  const posts = await fastify.mongo.db.collection('posts')
    .find()
    .sort({ createdAt: -1 }) // Bài mới nhất hiện lên đầu
    .toArray();

  return reply.view('admin_blog.pug', { posts ,pendingCount }); 
});

fastify.post('/admin/blog/save', async (request, reply) => {
  const { pipeline } = require('stream/promises');
  const fs = require('fs');
  const path = require('path');

  console.log('--- Bắt đầu nhận yêu cầu lưu Blog ---');
  
  const parts = request.parts();
  let title, content, fileName;

  try {
    for await (const part of parts) {
      if (part.file) {
        console.log(`Đang xử lý file: ${part.filename}`);
        
        fileName = `${Date.now()}-${part.filename}`;
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        
        if (!fs.existsSync(uploadDir)) {
          console.log('Thư mục uploads chưa có, đang tạo mới...');
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const savePath = path.join(uploadDir, fileName);
        await pipeline(part.file, fs.createWriteStream(savePath));
        console.log(`Đã lưu file thành công tại: ${savePath}`);
      } else {
        // Log các trường chữ
        if (part.fieldname === 'title') {
          title = part.value;
          console.log(`Đã nhận Title: ${title}`);
        }
        if (part.fieldname === 'content') {
          content = part.value;
          console.log('Đã nhận Content bài viết.');
        }
      }
    }

    // Kiểm tra dữ liệu cuối cùng
    if (!title || !content || !fileName) {
      console.error('Lỗi: Thiếu dữ liệu!', { title: !!title, content: !!content, file: !!fileName });
      return reply.code(400).send('Vui lòng nhập đầy đủ tiêu đề, nội dung và chọn ảnh!');
    }

    const slug = title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-') + '-' + Date.now();

    console.log(`Đang lưu vào Database với slug: ${slug}`);

    await fastify.mongo.db.collection('posts').insertOne({
      title,
      slug,
      content,
      image: `/public/uploads/${fileName}`,
      createdAt: new Date()
    });

    console.log('--- Lưu Blog thành công! Đang chuyển hướng... ---');
    return reply.redirect('/blog');

  } catch (err) {
    console.error('!!! LỖI TRONG QUÁ TRÌNH LƯU BLOG:', err.message);
    
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send('Lỗi: Ảnh quá lớn! Vui lòng chọn ảnh dưới 10MB.');
    }
    
    return reply.code(500).send('Lỗi hệ thống: ' + err.message);
  }
});


// 2. ROUTE XÓA (DELETE)
const { ObjectId } = require('@fastify/mongodb');
fastify.delete('/admin/blog/delete/:id', async (request, reply) => {
  try {
    const id = request.params.id;

    // Kiểm tra xem ID có đúng định dạng 24 ký tự hex của MongoDB không
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return reply.code(400).send({ success: false, error: 'ID không hợp lệ' });
    }

    const result = await fastify.mongo.db.collection('posts').deleteOne({ 
      _id: new ObjectId(id) 
    });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ success: false, error: 'Không tìm thấy bài viết' });
    }

    return { success: true };
  } catch (err) {
    fastify.log.error(err); // Xem lỗi chi tiết tại terminal
    return reply.code(500).send({ success: false, error: 'Lỗi server nội bộ' });
  }
});

// 3. ROUTE TRANG SỬA (GET)
fastify.get('/admin/blog/edit/:id', async (request, reply) => {
  const id = request.params.id;
  const post = await fastify.mongo.db.collection('posts').findOne({ _id: new ObjectId(id) });
  return reply.view('admin_edit_blog.pug', { post });
});
fastify.post('/admin/blog/update/:id', async (request, reply) => {
  const id = request.params.id;
  const parts = request.parts();
  let updateData = {};
  let newImage = null;

  for await (const part of parts) {
    if (part.file && part.filename) {
      const fileName = `${Date.now()}-${part.filename}`;
      const savePath = require('path').join(__dirname, 'public/uploads', fileName);
      const fs = require('fs');
      const { pipeline } = require('stream/promises');
      await pipeline(part.file, fs.createWriteStream(savePath));
      newImage = `/public/uploads/${fileName}`;
    } else if (part.fieldname) {
      updateData[part.fieldname] = part.value;
    }
  }

  const finalUpdate = {
    title: updateData.title,
    content: updateData.content,
    updatedAt: new Date()
  };
  if (newImage) finalUpdate.image = newImage;

  await fastify.mongo.db.collection('posts').updateOne(
    { _id: new ObjectId(id) },
    { $set: finalUpdate }
  );

  return reply.redirect('/admin/blog/create');
});


// 1. Hiển thị danh sách Voucher
fastify.get('/admin/vouchers', async (request, reply) => {
    try {
        const db = fastify.mongo.db;

        // 1. Lấy danh sách voucher cũ của bạn
        const vouchers = await db.collection('vouchers').find().sort({ _id: -1 }).toArray();
        console.log(`[Voucher Admin] Đã tải ${vouchers.length} mã voucher.`);
        
        // 2. [BỔ SUNG]: Đếm số đơn hàng có trạng thái 'pending' để nuôi Sidebar
        const orderColl = db.collection('orders');
        const pendingCount = await orderColl.countDocuments({ status: 'pending' });

        // 3. Truyền thêm biến pendingCount sang file Pug
        return reply.view('admin_vouchers.pug', { 
            vouchers, 
            pendingCount // <-- Thêm dòng này để sidebar không bị lỗi số đơn hàng
        });
    } catch (err) {
        console.error('[Voucher Admin Error]', err);
        reply.status(500).send('Lỗi tải danh sách voucher');
    }
});

// 1. Thêm mới
fastify.post('/admin/vouchers/add', async (request, reply) => {
    const { code, discountType, discountValue, minOrderValue, expiryDate } = request.body;
    console.log(`[Voucher Add] Đang tạo mã: ${code} - Loại: ${discountType}`);
    
    await fastify.mongo.db.collection('vouchers').insertOne({
        code: code.toUpperCase(),
        discountType,
        discountValue: parseInt(discountValue),
        minOrderValue: parseInt(minOrderValue),
        expiryDate: new Date(expiryDate),
        status: 'active'
    });
    
    console.log(`[Voucher Add] Thành công: ${code}`);
    reply.redirect('/admin/vouchers');
});

// 2. Chỉnh sửa (Update)
fastify.post('/admin/vouchers/edit/:id', async (request, reply) => {
    const { code, discountType, discountValue, minOrderValue, expiryDate } = request.body;
    console.log(`[Voucher Edit] Cập nhật ID: ${request.params.id} -> Mã mới: ${code}`);

    await fastify.mongo.db.collection('vouchers').updateOne(
        { _id: new ObjectId(request.params.id) },
        { $set: {
            code: code.toUpperCase(),
            discountType,
            discountValue: parseInt(discountValue),
            minOrderValue: parseInt(minOrderValue),
            expiryDate: new Date(expiryDate)
        }}
    );
    reply.redirect('/admin/vouchers');
});

// 3. Xóa (Delete)
fastify.delete('/admin/vouchers/delete/:id', async (request, reply) => {
    console.log(`[Voucher Delete] Đang xóa ID: ${request.params.id}`);
    await fastify.mongo.db.collection('vouchers').deleteOne({
        _id: new ObjectId(request.params.id)
    });
    reply.send({ ok: true });
});

// Áp dụng Voucher
fastify.post('/cart/apply-voucher', async (request, reply) => {
    const { voucherCode } = request.body;
    const cart = request.session.cart || []; 
    const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    // Lấy ID người dùng từ session
    const user = request.session.user; 

    console.log(`[Apply Voucher] User nhập: "${voucherCode}" | Tổng đơn: ${total}đ`);

    // 1. Kiểm tra đăng nhập (Bắt buộc để định danh người dùng)
    if (!user) {
        return reply.send({ success: false, msg: "Vui lòng đăng nhập để sử dụng mã giảm giá!" });
    }

    // Lấy ID ra an toàn (đề phòng trường hợp session dùng .id thay vì ._id)
    const currentUserId = (user.id || user._id || "").toString();
    
    if (!currentUserId) {
        return reply.send({ success: false, msg: "Lỗi dữ liệu người dùng. Vui lòng đăng nhập lại!" });
    }

    const voucher = await fastify.mongo.db.collection('vouchers').findOne({ 
        code: voucherCode.toUpperCase(),
        status: 'active' 
    });

    // 2. Kiểm tra tồn tại
    if (!voucher) {
        return reply.send({ success: false, msg: "Mã không tồn tại hoặc đã bị khóa!" });
    }

    // 3. LOGIC QUAN TRỌNG: Kiểm tra xem người này đã dùng mã này chưa
    if (voucher.usedBy && voucher.usedBy.includes(currentUserId)) {
        return reply.send({ success: false, msg: "Mã này bạn đã sử dụng rồi, không thể dùng thêm lần nữa!" });
    }

    // 4. Kiểm tra hạn sử dụng
    if (new Date() > new Date(voucher.expiryDate)) {
        return reply.send({ success: false, msg: "Mã giảm giá này đã hết hạn sử dụng!" });
    }

    // 5. Kiểm tra đơn tối thiểu
    if (total < voucher.minOrderValue) {
        return reply.send({ success: false, msg: `Đơn tối thiểu từ ${voucher.minOrderValue.toLocaleString()}đ` });
    }

    // 6. Tính số tiền giảm
    let discount = 0;
    if (voucher.discountType === 'percent') {
        discount = (total * voucher.discountValue) / 100;
    } else {
        discount = voucher.discountValue;
    }

    // Chặn tổng tiền âm
    if (discount >= total) {
        discount = total; 
    }

    // 7. Lưu vào session để dùng ở bước thanh toán
    request.session.appliedVoucher = {
        code: voucher.code,
        discountAmount: Math.round(discount)
    };

    return reply.send({ 
        success: true, 
        msg: "Đã áp dụng mã giảm giá thành công!",
        discountAmount: Math.round(discount),
        finalTotal: total - Math.round(discount) 
    });
});

// Gỡ Voucher
fastify.get('/cart/remove-voucher', async (request, reply) => {
    console.log(`[Voucher Remove] User gỡ bỏ mã: ${request.session.appliedVoucher?.code}`);
    request.session.appliedVoucher = null;
    return reply.redirect('/cart');
});


// Hiển thị Kho Voucher cho khách hàng (Client side)
fastify.get('/vouchers', async (request, reply) => {
    try {
        const now = new Date();
        const vouchers = await fastify.mongo.db.collection('vouchers').find({ 
            expiryDate: { $gte: now },
            status: 'active'
        }).sort({ expiryDate: 1 }).toArray();

        // --- COPY LOGIC TỪ BLOG SANG ĐỂ ĐỒNG BỘ NAVBAR ---
        const cart = request.session.get('cart') || [];
        const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
        const user = request.session.get('user');

        return reply.view('vouchers_client.pug', { 
            vouchers, 
            cartCount: totalItems, 
            session: { user: user } 
        });
    } catch (err) {
        console.error('[Client Voucher Error]', err);
        reply.status(500).send('Không thể tải kho voucher');
    }
});


fastify.post('/admin/orders/confirm-payment/:id', async (request, reply) => {
  const order = await db.collection('orders').findOne({ _id: new ObjectId(request.params.id) });
  
  if (order && order.userId) {
    // 1 điểm cho mỗi 10.000đ thanh toán
    const pointsToAdd = Math.floor(order.totalAmount / 10000);
    
    await db.collection('users').updateOne(
      { _id: order.userId },
      { $inc: { points: pointsToAdd } }
    );
  }
  
  await db.collection('orders').updateOne(
    { _id: new ObjectId(request.params.id) },
    { $set: { paymentStatus: 'paid', status: 'processing' } }
  );
  
  reply.redirect('/admin/orders');
});





// Route: Khách hàng upload ảnh minh chứng chuyển khoản
fastify.post('/orders/upload-proof/:id', async (request, reply) => {
  try {
    const { ObjectId } = fastify.mongo;
    const orderId = request.params.id;

    // 1. Đọc file từ form gửi lên
    const data = await request.file();
    if (!data) return reply.code(400).send('Chưa chọn ảnh minh chứng');

    // 2. Tạo tên file duy nhất và đường dẫn lưu
    const fileName = 'proof-' + Date.now() + '-' + data.filename;
    const uploadPath = path.join(__dirname, 'public/uploads/proofs', fileName);

    // 3. Tiến hành lưu file vào thư mục public/uploads/proofs
    await pump(data.file, fs.createWriteStream(uploadPath));

    // 4. Đường dẫn ảnh để lưu vào database
    const proofUrl = `/public/uploads/proofs/${fileName}`;

    // 5. Cập nhật vào đơn hàng trong MongoDB
    const collection = fastify.mongo.db.collection('orders');
    await collection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { paymentProof: proofUrl, updatedAt: new Date() } }
    );

    // 6. Quay lại trang thành công và thông báo đã gửi
    return reply.redirect(`/order-success/${orderId}?status=uploaded`);

  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi khi tải ảnh minh chứng");
  }
});
// Route: Hiển thị trang thông báo đặt hàng thành công
fastify.get('/order-success/:id', async (request, reply) => {
  try {
    const { ObjectId } = fastify.mongo;
    const orderId = request.params.id;

    // Lấy thông tin đơn hàng từ database để hiển thị
    const order = await fastify.mongo.db.collection('orders').findOne({
      _id: new ObjectId(orderId)
    });

    if (!order) {
      return reply.code(404).send('Không tìm thấy đơn hàng');
    }

    // Lấy trạng thái từ URL (nếu có) để hiển thị thông báo "Đã tải ảnh thành công"
    const status = request.query.status;

    return reply.view('order_success.pug', { 
      order, 
      status,
      session: request.session 
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send('Lỗi hiển thị trang thành công');
  }
});


// 1. GET: Hiển thị giao diện Form Nhập Kho
fastify.get('/admin/import-stock', async (request, reply) => {
  try {
    // Truy cập trực tiếp vào collection 'flowers' giống như các route khác của bạn
    const flowerColl = fastify.mongo.db.collection('flowers');
    
    // Lấy toàn bộ danh sách hoa để đưa vào thẻ select chọn hàng
    const flowers = await flowerColl.find({}).sort({ name: 1 }).toArray();
    
    // Đếm số đơn hàng chưa xử lý cho Sidebar/Navbar nếu giao diện admin cần dùng
    const orderColl = fastify.mongo.db.collection('orders');
    const pendingCount = await orderColl.countDocuments({ status: 'pending' });

    // Trả về file giao diện và truyền dữ liệu sang
    return reply.view('admin_import_stock.pug', {
      flowers,
      pendingCount,
      title: "Nhập hàng vào kho"
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Không thể tải trang nhập kho");
  }
});

// 2. POST: Xử lý nhận dữ liệu form - Tự động cộng kho và ghi lịch sử nhập
fastify.post('/admin/import-stock', async (request, reply) => {
  try {
    const { ObjectId } = fastify.mongo;
    
    // Lấy thông tin từ formbody gửi lên
    const { productId, quantity, importPrice, note } = request.body;

    const qtyNum = parseInt(quantity) || 0;
    const priceNum = parseFloat(importPrice) || 0;

    // A. Ghi lịch sử nhập kho vào collection 'import_history'
    const importHistoryColl = fastify.mongo.db.collection('import_history');
    await importHistoryColl.insertOne({
      product_id: new ObjectId(productId),
      quantity: qtyNum,
      import_price: priceNum,
      note: note || '',
      import_date: new Date() // Lưu thời gian nhập hàng phục vụ làm báo cáo tài chính
    });

    // B. Tự động cập nhật cộng dồn số lượng vào kho gốc (collection 'flowers')
    const flowerColl = fastify.mongo.db.collection('flowers');
    await flowerColl.updateOne(
      { _id: new ObjectId(productId) },
      { $inc: { stock: qtyNum } } // Dùng $inc tăng số lượng tự động cực kỳ an toàn
    );

    // C. Thành công, điều hướng về lại trang danh sách quản lý
    return reply.redirect('/admin/import-history');

  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Xử lý nhập kho thất bại");
  }
});

// 3. GET: Hiển thị trang Quản lý nhập kho (Gộp lịch sử + Form)
fastify.get('/admin/import-history', async (request, reply) => {
  try {
    const db = fastify.mongo.db;
    
    // [BỔ SUNG]: Lấy danh sách toàn bộ hoa để truyền vào Modal nhập kho
    const flowerColl = db.collection('flowers');
    const flowers = await flowerColl.find({}).sort({ name: 1 }).toArray();

    // Dùng Aggregate để nối bảng lịch sử với bảng hoa lấy thông tin hiển thị
    const history = await db.collection('import_history').aggregate([
      {
        $lookup: {
          from: 'flowers',
          localField: 'product_id',
          foreignField: '_id',
          as: 'flower_info'
        }
      },
      {
        $unwind: {
          path: '$flower_info',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $sort: { import_date: -1 }
      }
    ]).toArray();

    // Đếm số đơn hàng chưa xử lý cho Sidebar
    const orderColl = db.collection('orders');
    const pendingCount = await orderColl.countDocuments({ status: 'pending' });

    // Trả về view và truyền ĐẦY ĐỦ cả 'history' và 'flowers' sang cho Pug
    return reply.view('admin_import_history.pug', {
      history,
      flowers, // <--- Biến quyết định cứu bạn khỏi lỗi undefined đây!
      pendingCount,
      title: "Quản lý nhập kho"
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send("Lỗi không thể tải trang quản lý nhập kho");
  }
});














// Khởi động Server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log("Web đang chạy tại: http://localhost:3000");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();